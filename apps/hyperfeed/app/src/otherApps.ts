import type { AppInfo } from "@calimero-network/mero-js";
import { camel } from "./hyperfeed";
import { type ClientRoutes } from "@calimero-apps/connect";

/**
 * Your OTHER apps on the cluster, as the feed reaches them: the lens reads an
 * event's app, a typed row is answered in its app, and the collector lists
 * them and follows their events.
 *
 * Lenses, reply calls and drafts' send calls name methods and arguments as v1
 * apps did (`get_message`, `{ "message_id": … }`). A component app's ABI names
 * them in camelCase (`getMessage`, `{ "messageId": … }`), so this is where one
 * becomes the other: the method name and the top-level argument names. Values
 * are passed as they are.
 */
export interface OtherApps {
  /** A logged call: how a row is answered, or a draft sent, in its app. */
  call(app: string, method: string, args: Record<string, unknown>): Promise<unknown>;
  /** A read: what a lens looks up about an event. */
  view(app: string, method: string, args: Record<string, unknown>): Promise<unknown>;
}

/** A v1 method's arguments as a component app takes them. */
export function wireArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).map(([k, v]) => [camel(k), v]));
}

export function otherApps(client: ClientRoutes<{ apps: "call" | "view" }>): OtherApps {
  return {
    call: async (app, method, args) =>
      (await client.apps.call({ app, method: camel(method), args: wireArgs(args) })).result,
    view: async (app, method, args) =>
      (await client.apps.view({ app, method: camel(method), args: wireArgs(args) })).result,
  };
}

/** Hyperfeed's own package, by its last part: a feed of feeds would record its own bookkeeping as news. */
export function isHyperfeed(app: Pick<AppInfo, "package">, ownBundle?: string | null, bundle?: string): boolean {
  if (ownBundle && bundle === ownBundle) return true;
  return (app.package ?? "").split(".").pop() === "hyperfeed";
}
