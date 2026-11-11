/**
 * Moving an app instance to another organization (core `POST /apps/{app}/move`),
 * and merging one organization into another with it. No React.
 *
 * Core decides everything: the mover must manage the app where it is and be an
 * admin of the target; the app's data stays where it is; its payer, quotas and
 * access go to the target; `bringMembers` adds the people of its organization
 * who reach it (as members at most). Each move takes its own passkey prompt:
 * the node asks for consent over one app at a time.
 *
 * A node from before the route answers a bare `404` (no `NOT_FOUND` code: the
 * route is not there), and Home hides both "Move to another organization" and
 * "Merge organizations" ({@link movesSupported}).
 */
import { describeError, type ClientRoutes, type MyOrg } from "@calimero-apps/connect";
import { passkeyConfirm, type CalimeroClient, type OrgInvite, type PasskeyProvider } from "@calimero-network/mero-js";

import { peopleOf, type Person, type Role } from "./home";

/** An app id no node holds: what {@link movesSupported} asks to move. */
export const MOVE_PROBE = "mero-home-move-probe";

/**
 * Whether the node moves apps between organizations. It asks to move an app
 * that does not exist: a node with the route answers `404 NOT_FOUND` (no such
 * app), one without it a bare `404` (or `405`). Anything that is not an API
 * answer (the node unreachable) reads as no, so nothing is offered that fails.
 */
export async function movesSupported(client: ClientRoutes<{ apps: "move" }>): Promise<boolean> {
  try {
    await client.apps.move({ app: MOVE_PROBE, toOrg: "" });
    return true;
  } catch (e) {
    const { status, code } = (e ?? {}) as { status?: unknown; code?: unknown };
    if (typeof status !== "number") return false;
    if (status === 405) return false;
    if (status === 404) return code === "NOT_FOUND";
    return true;
  }
}

/** What core answers a move. */
export interface MoveResult {
  appId: string;
  /** The organization it left; `null` for a personal app. */
  from: string | null;
  org: string;
  access: Record<string, unknown>;
  /** Whether the target's app team of its package was made for it. */
  created: boolean;
  /** Accounts that joined the target with it. */
  added: string[];
  revokedInvites: number;
}

/** Move `app` to `toOrg`, approved with `passkey`. */
export async function moveApp(
  client: ClientRoutes<{ apps: "move" }>,
  app: string,
  toOrg: string,
  bringMembers: boolean,
  passkey: PasskeyProvider,
): Promise<MoveResult> {
  return await client.apps.move({ app, toOrg, bringMembers }, { confirm: passkeyConfirm(passkey) });
}

function administers(o: MyOrg): boolean {
  return o.role === "owner" || o.role === "admin";
}

/** Where an app of `from` may go: the other organizations the caller administers. */
export function moveTargets(orgs: readonly MyOrg[], from: string): MyOrg[] {
  return orgs.filter((o) => administers(o) && o.orgId !== from);
}

/** What may be merged into `into`: the other organizations the caller administers. */
export const mergeSources = moveTargets;

/** One app a merge moves. */
export interface MergeApp {
  app: string;
  name: string;
  package: string | null;
}

/** An organization to merge, as the admin sees it before anything moves. */
export interface MergePlan {
  source: string;
  name: string;
  /** The caller's role in it: only its owner deletes it afterwards. */
  role: Role | null;
  apps: MergeApp[];
  people: Person[];
  invites: OrgInvite[];
}

/**
 * Reads `source` for a merge: every app it holds (`appsReportAll`, which lists
 * to an admin the apps they reach or manage), its people and its pending
 * invites. Invites the caller may not list read as none.
 */
export async function loadMergePlan(
  client: Pick<CalimeroClient, "appsReportAll"> & ClientRoutes<{ orgs: "get" | "inviteList" }>,
  source: string,
  account: string,
): Promise<MergePlan> {
  const [info, report, invites] = await Promise.all([
    client.orgs.get({ org: source }),
    client.appsReportAll(source),
    client.orgs
      .inviteList({ org: source })
      // The document lets an invite carry the `owner` role; mero-js's `OrgInvite` does not.
      .then((r) => r.invites as OrgInvite[])
      .catch(() => [] as OrgInvite[]),
  ]);
  const people = peopleOf(info);
  return {
    source,
    name: typeof info.name === "string" && info.name ? info.name : source,
    role: people.find((p) => p.account === account)?.role ?? null,
    apps: report.apps.map((a) => ({
      app: a.app,
      name: a.name || a.app,
      package: a.package?.package ?? null,
    })),
    people,
    invites,
  };
}

/** How one app's move went. */
export type MoveOutcome = MergeApp & ({ ok: true; result: MoveResult } | { ok: false; error: string });

/**
 * Moves every app of `plan` to `target`, one after another (one passkey prompt
 * each), and reports each as it finishes. A refusal (quota, an owner outside
 * the target, an app on a sub-team) is that app's outcome; the rest go on.
 */
export async function moveEvery(
  client: ClientRoutes<{ apps: "move" }>,
  plan: Pick<MergePlan, "apps">,
  target: string,
  bringMembers: boolean,
  passkey: () => PasskeyProvider,
  onEach: (outcome: MoveOutcome) => void = () => {},
): Promise<MoveOutcome[]> {
  const outcomes: MoveOutcome[] = [];
  for (const a of plan.apps) {
    let outcome: MoveOutcome;
    try {
      outcome = { ...a, ok: true, result: await moveApp(client, a.app, target, bringMembers, passkey()) };
    } catch (e) {
      outcome = { ...a, ok: false, error: describeError(e) };
    }
    outcomes.push(outcome);
    onEach(outcome);
  }
  return outcomes;
}

/** Whether the caller may delete `plan`'s organization now: its owner, once it holds no app. */
export function mayDeleteSource(plan: Pick<MergePlan, "role" | "apps">): boolean {
  return plan.role === "owner" && plan.apps.length === 0;
}

/** The typed confirmation a deletion takes: the organization's name, exactly (spaces around it aside). */
export function confirmsName(typed: string, name: string): boolean {
  return typed.trim() === name.trim() && name.trim() !== "";
}
