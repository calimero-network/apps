import { timeLabel } from "./format";

import type { AppInfo, CalimeroClient } from "@calimero-network/mero-js";
import type { AppSource } from "@calimero-apps/connect";

/**
 * Your feeds on the cluster, told apart: by name, and by how much each holds
 * and when it last moved, so an old or empty one can be found and deleted.
 *
 * A feed is an app instance of Hyperfeed (v1's context), in an organization of
 * its own (v1's namespace): you own it, and the cloud agents you let work it
 * are invited into that organization.
 */

/** What the switcher says about one feed. */
export interface FeedFacts {
  /** Chains in it, archived ones included; null when it could not be read. */
  rows: number | null;
  /** When anything in it last happened (ms); 0 when nothing has. */
  at: number;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function isEmpty(f: FeedFacts | undefined): boolean {
  return f?.rows === 0;
}

/** One line under a feed's id: "39 rows · 14:02", "Empty", or nothing while it is read. */
export function factsLine(f: FeedFacts | undefined, now = Date.now()): string {
  if (!f) return "";
  if (f.rows === null) return "Could not read it";
  if (f.rows === 0) return "Empty";
  return `${count(f.rows, "row")}${f.at ? ` · ${timeLabel(f.at, now)}` : ""}`;
}

/** The confirm, naming what goes: "Delete this feed and its 39 rows? This can't be undone." */
export function confirmText(f: FeedFacts | undefined): string {
  if (f?.rows === 0) return "Delete this empty feed? This can't be undone.";
  if (f?.rows) return `Delete this feed and its ${count(f.rows, "row")}? This can't be undone.`;
  return "Delete this feed and everything in it? This can't be undone.";
}

/**
 * The order the switcher lists feeds in: the open one first, then the empty
 * ones (the first to delete), then the rest, latest activity first.
 */
export function orderFeeds(ids: string[], current: string, facts: Record<string, FeedFacts | undefined>): string[] {
  const rank = (id: string) => (id === current ? 0 : isEmpty(facts[id]) ? 1 : 2);
  return [...ids].sort((a, b) => rank(a) - rank(b) || (facts[b]?.at ?? 0) - (facts[a]?.at ?? 0));
}

/** The longest name a feed takes. */
export const NAME_MAX = 64;

/** What is wrong with a name, or null when it will do. */
export function nameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return "Give the feed a name.";
  if (n.length > NAME_MAX) return `A name is at most ${NAME_MAX} characters.`;
  return null;
}

/** A name for a new feed: "My feed", or "My feed 2" when that is taken. */
export function suggestName(taken: Iterable<string | null>, base = "My feed"): string {
  const used = new Set([...taken].filter((n): n is string => Boolean(n)).map((n) => n.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let i = 2;
  while (used.has(`${base} ${i}`.toLowerCase())) i++;
  return `${base} ${i}`;
}

/** The short id shown beside a name: "c8c2844e". */
export function hint(id: string): string {
  return id.slice(0, 8);
}

/** A feed as the switcher calls it: "Work · c8c2844e", or "Unnamed feed · c8c2844e". */
export function feedLabel(name: string | null | undefined, id: string): string {
  return `${name || "Unnamed feed"} · ${hint(id)}`;
}

/** The feeds this account reaches: instances of the dev bundle, or of the package. */
export async function listFeeds(client: Pick<CalimeroClient, "listApps">, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps = await client.listApps(filter);
  return [...apps].sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

/**
 * Make a feed named `name`: an organization of its own first (where cloud
 * agents are invited), then the instance in it. Answers its app id.
 */
export async function createFeed(
  client: Pick<CalimeroClient, "createApp" | "createOrg">,
  source: AppSource,
  name: string,
): Promise<string> {
  const problem = nameProblem(name);
  if (problem) throw new Error(problem);
  const org = await client.createOrg(name.trim());
  return client.createApp(name.trim(), source, { org });
}

/**
 * Delete a feed: its app instance, with everything in it. The organization it
 * was made in stays (deleting one is a passkey step-up of its own, from the
 * cluster's console).
 */
export async function deleteFeed(client: Pick<CalimeroClient, "deleteApp">, app: string): Promise<void> {
  await client.deleteApp(app);
}

/** Every feed's name: the one set in its metadata (a rename), else the one it was created with. */
export async function readFeedNames(
  client: Pick<CalimeroClient, "getApp">,
  feeds: Pick<AppInfo, "appId" | "name">[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  await Promise.all(
    feeds.map(async (f) => {
      const meta = await client
        .getApp(f.appId)
        .then((a) => (a.metadata ?? null) as { name?: unknown } | null)
        .catch(() => null);
      const renamed = typeof meta?.name === "string" ? meta.name.trim() : "";
      out[f.appId] = renamed || f.name.trim() || null;
    }),
  );
  return out;
}

/** Rename a feed: its metadata's `name`, keeping whatever else the metadata holds. */
export async function renameFeed(
  client: Pick<CalimeroClient, "getApp" | "setAppMetadata">,
  app: string,
  name: string,
): Promise<void> {
  const problem = nameProblem(name);
  if (problem) throw new Error(problem);
  const meta = await client
    .getApp(app)
    .then((a) => (a.metadata ?? {}) as Record<string, unknown>)
    .catch(() => ({}));
  await client.setAppMetadata(app, { ...(typeof meta === "object" && meta ? meta : {}), name: name.trim() });
}
