/**
 * An app's `scenarios/*.json` on `merod local`: the steps `cargo test` runs in
 * core's harness, run again as real accounts on a real cluster through the
 * same client a frontend uses (mero-js `CalimeroClient`), each account on a
 * different node. As core's `crates/node/tests/rooms.rs` runs `rooms.json`.
 *
 * Per scenario: a fresh org (`owner` creates it; `<name>.org.json` lists who
 * is invited as admin, member or guest, and who signs up without joining), a
 * fresh app from the uploaded bundle in that org, and an event stream per
 * account from the app's first index.
 */

import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

import { CalimeroClient, type CloudEvent } from "@calimero-network/mero-js";

import { LOCAL_NODES, localClient, signUp, type Person } from "./cluster.ts";
import { accounts, check, substitute, unsupported, type OrgSpec, type Outcome, type Step } from "./scenario.ts";

const EVENT_WAIT_MS = 15_000;

export type Result = { file: string; status: "passed" } | { file: string; status: "skipped"; reason: string };

interface Listener {
  seen: string[];
  stop(): void;
}

function listen(client: CalimeroClient, app: string): Listener {
  const seen: string[] = [];
  const abort = new AbortController();
  void (async () => {
    try {
      for await (const event of client.events(app, 0, abort.signal) as AsyncGenerator<CloudEvent>) seen.push(event.kind);
    } catch {
      // An account the org does not hold, or one removed mid-run, has its stream
      // refused or cut: it simply hears nothing more, which is what the
      // scenario's `events` say.
    }
  })();
  return { seen, stop: () => abort.abort() };
}

async function until(what: string, ok: () => boolean, ms = EVENT_WAIT_MS): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

function readOrg(file: string): OrgSpec {
  const path = file.replace(/\.json$/, ".org.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as OrgSpec) : {};
}

function roleOf(org: OrgSpec, name: string): "admin" | "member" | "guest" | undefined {
  if (org.admins?.includes(name)) return "admin";
  if (org.members?.includes(name)) return "member";
  if (org.guests?.includes(name)) return "guest";
  return undefined;
}

/** Runs one scenario file against the cluster at `nodes` with the uploaded `bundle`. */
export async function runScenario(file: string, bundle: string, nodes: string[] = LOCAL_NODES): Promise<Result> {
  const steps = JSON.parse(readFileSync(file, "utf8")) as Step[];
  if (!Array.isArray(steps)) throw new Error(`${file}: a scenario is a JSON array of steps`);
  const org = readOrg(file);
  const reason = unsupported(steps, org);
  if (reason) return { file, status: "skipped", reason };

  const run = `${basename(file, ".json")}-${Date.now().toString(36)}`;
  const people = new Map<string, Person>();
  const names = accounts(steps, org);
  // Round-robin over the nodes: a write from a follower is forwarded to the
  // leader, a view is answered where it is asked.
  for (const [i, name] of names.entries()) {
    people.set(name, await signUp(`${name}-${run}`, nodes[i % nodes.length] as string, nodes));
  }
  const owner = people.get("owner") as Person;
  const orgId = await owner.client.createOrg(`e2e ${run}`);
  for (const name of names) {
    const role = roleOf(org, name);
    if (!role) continue;
    const token = await owner.client.invite(orgId, role, owner.passkey);
    await (people.get(name) as Person).client.redeemInvite(token);
  }
  const app = await owner.client.createApp(`e2e-${run}`, bundle, { org: orgId });

  const listeners = new Map<string, Listener>();
  for (const [name, person] of people) listeners.set(name, listen(person.client, app));
  const anonymous = localClient(nodes[0] as string, nodes);
  const accountOf = (name: string) => {
    const person = people.get(name);
    if (!person) throw new Error(`@${name} is not an account of this scenario`);
    return person.accountId;
  };

  const vars = new Map<string, unknown>();
  try {
    for (const [n, step] of steps.entries()) {
      try {
        const args = substitute(step.args ?? {}, vars, accountOf);
        let outcome: Outcome;
        if (step.op === "removeMember") {
          const who = typeof step.args === "string" ? step.args : String(args);
          await owner.client.removeMember(orgId, accountOf(who), owner.passkey);
          outcome = { ok: true, value: null };
        } else {
          const as = step.as ?? "owner";
          const person = as === "@anonymous" ? undefined : people.get(as);
          const client = person?.client ?? anonymous;
          const method = step.method;
          if (!method) throw new Error("a call or view names its `method`");
          try {
            const value =
              step.op === "view"
                ? (await client.view(app, method, args)).result
                : step.confirmed && person
                  ? (await client.callConfirmed(app, method, args, person.passkey)).result
                  : (await client.call(app, method, args)).result;
            outcome = { ok: true, value };
          } catch (error) {
            outcome = { ok: false, error };
          }
        }
        check(step.expect ? (substitute(step.expect, vars, accountOf) as Record<string, unknown>) : undefined, outcome);
        if (step.save && outcome.ok) vars.set(step.save, outcome.value);
        for (const [who, want] of Object.entries(step.events ?? {})) {
          const listener = listeners.get(who);
          if (!listener) throw new Error(`no event stream for ${who}`);
          await until(`${who}: ${want.join(", ")}`, () => listener.seen.length >= want.length);
          if (JSON.stringify(listener.seen) !== JSON.stringify(want)) {
            throw new Error(`${who} heard ${JSON.stringify(listener.seen)}, expected ${JSON.stringify(want)}`);
          }
        }
      } catch (error) {
        throw new Error(`step ${n} ${JSON.stringify(step)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    for (const listener of listeners.values()) listener.stop();
  }
  return { file, status: "passed" };
}
