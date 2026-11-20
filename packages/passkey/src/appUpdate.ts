/**
 * Whether an update is available for one app instance, and whether the
 * signed-in person may approve it: core's `GET /apps/{app}/update`
 * (`app_update`, core#5192), read for a workspace's settings
 * ({@link ./WorkspaceUpdates}).
 *
 * The node answers, for whoever may read the app (a session bound to its
 * package's frontend included):
 *
 * - `running`: the release the instance runs (`null` for a raw bundle);
 * - `available`: for an instance from a deployment, the release its
 *   deployment offers when it is not the one running (`source: deployment`);
 *   for any other, the newest newer release of its package the caller sees
 *   that the upgrade would take (`source: release`); else `null`;
 * - `mayApprove`: whether this caller may approve it;
 * - `approvers`: who does. `owner-and-admins` (the owner and admins of the
 *   app's organization, core#5192's rule), `operator` where the cluster gives
 *   app upgrades to its operator, or `managers` on a cluster still below
 *   1.0.0-rc.32 (the rule before: the owner or `MANAGE_APPLICATION` holders,
 *   or the publisher's).
 *
 * A node from before the route answers it `404`; the same facts are then
 * worked out from the version report as the in-app prompt does
 * ({@link upgradeOffer}), under the rule such a node applies (`managers`).
 *
 * TODO(core#5192): once a mero-js release generates `client.apps.update`
 * (`GET /apps/{app}/update`) and the `component` catalog moves to it, call
 * it directly in {@link fetchAppUpdate} and drop the `transport` fallback
 * there. The report fallback below stays for clusters still below
 * 1.0.0-rc.32, until every cluster the apps run on serves the route.
 */
import { CalimeroError, routePath, type CalimeroClient } from "@calimero-network/mero-js";
import { instancePackage } from "@calimero-apps/connect";

import { upgradeOffer, type UpgradeClient } from "./upgrade";

/** Who approves an instance's upgrades, as the node says (`approvers`). */
export type UpdateApprovers = "owner-and-admins" | "operator" | "managers";

/** `GET /apps/{app}/update`'s answer (core#5192's `app_update`), plus where it came from. */
export interface AppUpdate {
  app: string;
  /** The release the instance runs; `null` for a raw bundle. */
  running: { package: string; version: string } | null;
  /** The release an upgrade would move it to now; `null` when there is none. */
  available: { package: string; version: string; source: "deployment" | "release" } | null;
  /** Whether the signed-in person may approve that upgrade. */
  mayApprove: boolean;
  approvers: UpdateApprovers;
  /** `route`: the node's own answer; `report`: worked out from the version report, on a node without the route. */
  via: "route" | "report";
}

/** The part of the client {@link readAppUpdate} uses. */
export type AppUpdateClient = UpgradeClient & Partial<Pick<CalimeroClient, "transport">>;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function release(v: unknown): { package: string; version: string } | null {
  const r = rec(v);
  const pkg = str(r.package);
  const version = str(r.version);
  return pkg && version ? { package: pkg, version } : null;
}

/** The route's JSON, read defensively: a field a node leaves out or misspells is "unknown", never a crash. */
export function parseAppUpdate(app: string, answer: unknown): AppUpdate {
  const a = rec(answer);
  const running = release(a.running);
  const offered = release(a.available);
  const source = rec(a.available).source === "deployment" ? "deployment" : "release";
  const approvers: UpdateApprovers =
    a.approvers === "operator" ? "operator" : a.approvers === "managers" ? "managers" : "owner-and-admins";
  return {
    app: str(a.app) ?? app,
    running,
    available: offered ? { ...offered, source } : null,
    // Never offered where nobody in the instance approves.
    mayApprove: a.mayApprove === true && approvers !== "operator",
    approvers,
    via: "route",
  };
}

/**
 * `GET /apps/{app}/update` through the client.
 *
 * TODO(core#5192): `client.apps.update({ app })` once the published mero-js
 * generates it; until then the route is sent through the client's own
 * transport (the attested, sealed channel and the session every generated
 * method uses), the one place in the apps that names this path.
 */
async function fetchAppUpdate(client: AppUpdateClient, app: string): Promise<unknown> {
  const generated = (client.apps as { update?: (args: { app: string }) => Promise<unknown> } | undefined)?.update;
  if (typeof generated === "function") return generated.call(client.apps, { app });
  if (!client.transport) throw new Error("this client cannot read whether an update is available");
  return client.transport.json("GET", routePath("apps/{app}/update", { app }));
}

/** The answer worked out from the version report, for a node without the route (before core#5192). */
async function fromReport(client: AppUpdateClient, app: string): Promise<AppUpdate> {
  const offer = await upgradeOffer(client, app);
  if (offer) {
    const pkg = offer.package ?? null;
    return {
      app,
      running: pkg ? { package: pkg, version: offer.current } : null,
      available: pkg && offer.reachable ? { package: pkg, version: offer.latest, source: "release" } : null,
      mayApprove: offer.canUpgrade && offer.heldBy === "owner",
      approvers: offer.heldBy === "operator" ? "operator" : "managers",
      via: "report",
    };
  }
  // Up to date (or nothing the report lists): the release it runs, if any. A failed read throws.
  const running = await instancePackage(client, app);
  return {
    app,
    running: running ? { package: running.package, version: running.version } : null,
    available: null,
    mayApprove: false,
    approvers: "managers",
    via: "report",
  };
}

/**
 * Whether an update is available for `app` and whether this person may
 * approve it. Throws when the node cannot be read (the caller offers "Try
 * again"); a node without the route answers from the version report.
 */
export async function readAppUpdate(client: AppUpdateClient, app: string): Promise<AppUpdate> {
  try {
    return parseAppUpdate(app, await fetchAppUpdate(client, app));
  } catch (e) {
    // A node before core#5192 has no such route (or, from either, no such app: the report then fails too).
    if (e instanceof CalimeroError && e.status === 404) return fromReport(client, app);
    throw e;
  }
}
