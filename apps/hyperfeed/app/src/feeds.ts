import { timeLabel } from "./format";

/**
 * Your feeds on this node, told apart: how much each holds and when it last
 * moved, so an old or empty one can be found and deleted.
 */

/** What the switcher says about one feed. */
export interface FeedFacts {
  /** Chains in it, archived ones included; null when it could not be read. */
  rows: number | null;
  /** When anything in it last happened (ms); 0 when nothing has. */
  at: number;
}

/** The node calls deleting a feed takes. */
export interface FeedAdmin {
  getContextGroup(contextId: string): Promise<string | null>;
  deleteContext(contextId: string): Promise<unknown>;
  listGroupContexts(groupId: string): Promise<{ contextId: string }[]>;
  deleteNamespace(namespaceId: string): Promise<unknown>;
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

/**
 * Delete a feed: its context, then its namespace once nothing else is in it.
 * A feed is made in a namespace of its own, so that is the usual case; a
 * namespace still holding another context is left alone. Resolves to whether
 * the namespace went too.
 */
export async function deleteFeed(admin: FeedAdmin, contextId: string): Promise<{ namespace: boolean }> {
  const group = await admin.getContextGroup(contextId).catch(() => null);
  await admin.deleteContext(contextId);
  if (!group) return { namespace: false };
  const left = await admin.listGroupContexts(group).catch(() => null);
  if (!left || left.some((c) => c.contextId !== contextId)) return { namespace: false };
  await admin.deleteNamespace(group);
  return { namespace: true };
}
