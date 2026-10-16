import { timeLabel } from "./format";

/**
 * Your feeds on this node, told apart: by name, and by how much each holds
 * and when it last moved, so an old or empty one can be found and deleted.
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
 *
 * ⚠️ The context delete is tolerated when the feed is alone in its namespace.
 * The namespace delete only UNREGISTERS its contexts (their data stays), so
 * the context goes first wherever it can — but `DELETE /admin-api/contexts/:id`
 * needs `context:delete`, which an app's grant set signed in from a browser
 * may not carry. A refusal there must not leave the feed undeletable: the
 * namespace still goes, and the feed with it out of every listing.
 */
export async function deleteFeed(admin: FeedAdmin, contextId: string): Promise<{ namespace: boolean }> {
  const group = await admin.getContextGroup(contextId).catch(() => null);
  const inGroup = group ? await admin.listGroupContexts(group).catch(() => null) : null;
  const alone = !!group && !!inGroup && inGroup.every((c) => c.contextId === contextId);
  if (!alone) {
    await admin.deleteContext(contextId);
    return { namespace: false };
  }
  await admin.deleteContext(contextId).catch(() => {});
  await admin.deleteNamespace(group);
  return { namespace: true };
}

/**
 * A feed's name is its namespace's: what `list_namespaces`, meroctl and the
 * admin dashboard show. A feed has a namespace of its own, so one listing of
 * the app's namespaces names every feed. Creating and renaming set the
 * context's name too.
 */

/** The longest name a feed takes. */
export const NAME_MAX = 64;

/** One feed's name, and the namespace it is in; `name` is null for a feed made unnamed. */
export interface FeedName {
  name: string | null;
  namespace: string | null;
}

type Metadata = { name: string | null; data: Record<string, string> } | null;

/** The node calls naming feeds takes. */
export interface NamesAdmin {
  getContextsForApplication(applicationId: string): Promise<{ contexts: { id: string; groupId?: string }[] }>;
  listNamespacesForApplication(applicationId: string): Promise<{ namespaceId: string; name?: string }[]>;
  getContextGroup(contextId: string): Promise<string | null>;
  getGroupMetadata(groupId: string): Promise<Metadata>;
  setGroupMetadata(groupId: string, request: { name?: string; data?: Record<string, string> }): Promise<unknown>;
  getContextMetadata(groupId: string, contextId: string): Promise<Metadata>;
  setContextMetadata(groupId: string, contextId: string, request: { name?: string; data?: Record<string, string> }): Promise<unknown>;
}

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

/** Every feed's name, in two calls however many feeds there are. */
export async function readFeedNames(admin: NamesAdmin, applicationId: string): Promise<Record<string, FeedName>> {
  const [{ contexts }, namespaces] = await Promise.all([
    admin.getContextsForApplication(applicationId),
    admin.listNamespacesForApplication(applicationId),
  ]);
  const names = new Map(namespaces.map((n) => [n.namespaceId, n.name?.trim() || null]));
  const out: Record<string, FeedName> = {};
  for (const c of contexts) {
    // An older node lists contexts without their group: ask for it.
    const namespace = c.groupId ?? (await admin.getContextGroup(c.id).catch(() => null));
    out[c.id] = { name: (namespace && names.get(namespace)) || null, namespace };
  }
  return out;
}

/**
 * Rename a feed: its namespace and its context. Setting a record replaces
 * its data, so what is there is passed back.
 */
export async function renameFeed(admin: NamesAdmin, contextId: string, namespace: string | null, name: string): Promise<void> {
  const problem = nameProblem(name);
  if (problem) throw new Error(problem);
  const n = name.trim();
  const group = namespace ?? (await admin.getContextGroup(contextId));
  if (!group) throw new Error("This feed's namespace could not be found.");
  const ns = await admin.getGroupMetadata(group).catch(() => null);
  await admin.setGroupMetadata(group, { name: n, data: ns?.data ?? {} });
  const ctx = await admin.getContextMetadata(group, contextId).catch(() => null);
  await admin.setContextMetadata(group, contextId, { name: n, data: ctx?.data ?? {} });
}
