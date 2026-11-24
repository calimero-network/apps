/**
 * A real node for the extension to save to: core's `merod local` (three nodes
 * on 127.0.0.1:2501-2503). One already running is used (`pnpm dev:local`
 * starts one); otherwise one is started when `merod` runs (MEROD_BIN, or on
 * the PATH). Minutes' contract is uploaded as a raw bundle, an account signs up
 * with a software passkey, and its organization holds two workspaces.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOCAL_NODES,
  ROOT,
  healthy,
  localClient,
  merodBinary,
  signUp,
  startCluster,
  type Person,
  type Started,
} from "../../../../packages/merod-local/src/cluster.ts";
import { spawnSync } from "node:child_process";

export interface HandoffSession {
  v: 1;
  accountId: string;
  sessionToken: string;
  expiresAt: number;
  refreshToken: string;
  nodeUrl: string;
  nodes: string[];
}

export interface Seeded {
  person: Person;
  org: string;
  bundle: string;
  workspaces: { appId: string; name: string }[];
  /** A fresh session for this account, as the page would hand one over. */
  session(): Promise<HandoffSession>;
  /** Another workspace in the same organization. */
  createWorkspace(name: string): Promise<{ appId: string; name: string }>;
  view<T>(app: string, method: string, args?: Record<string, unknown>): Promise<T>;
  stop(): void;
}

const NODE = LOCAL_NODES[0] as string;

/** Why the node-backed tests cannot run here, or null. */
export async function unavailable(): Promise<string | null> {
  if (await healthy(NODE)) return null;
  const probe = spawnSync(merodBinary(), ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return "no merod local on :2501 and no merod binary (MEROD_BIN) to start one";
  return null;
}

function wasm(): string {
  const res = join(ROOT, "apps", "mero-minutes", "logic", "res");
  const file = readdirSync(res).find((f) => f.endsWith(".wasm"));
  if (!file) throw new Error("apps/mero-minutes/logic/res has no .wasm: run scripts/component-build.sh apps/mero-minutes/logic");
  return join(res, file);
}

export async function seed(): Promise<Seeded> {
  let started: Started | null = null;
  if (!(await healthy(NODE))) started = await startCluster({ fresh: true, log: join(ROOT, ".merod-local", "extension-e2e.log") });
  const run = Date.now().toString(36);
  const person = await signUp(`ana-${run}`, NODE);
  const bundle = (
    await person.client.packages.bundlePut({ body: new Uint8Array(readFileSync(wasm())), contentType: "application/wasm" })
  ).hash;
  const org = (await person.client.orgs.create({ name: `Minutes e2e ${run}` })).orgId;
  const createWorkspace = async (name: string) => {
    const appId = (await person.client.apps.create({ name, bundle, org })).appId;
    return { appId, name };
  };
  const workspaces = [await createWorkspace("Team"), await createWorkspace("Sales")];
  const nodes = LOCAL_NODES.filter((n) => n !== NODE);
  return {
    person,
    org,
    bundle,
    workspaces,
    async session() {
      const s = (await localClient(NODE).signIn(person.passkey)) as unknown as Omit<HandoffSession, "v" | "nodeUrl" | "nodes">;
      return {
        v: 1,
        accountId: s.accountId,
        sessionToken: s.sessionToken,
        expiresAt: s.expiresAt,
        refreshToken: s.refreshToken,
        nodeUrl: NODE,
        nodes,
      };
    },
    createWorkspace,
    async view<T>(app: string, method: string, args: Record<string, unknown> = {}) {
      return (await person.client.apps.view({ app, method, args })).result as T;
    },
    stop() {
      started?.stop();
    },
  };
}
