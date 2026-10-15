import type { NamesAdmin } from "./directory";

/**
 * The name to show for a group (a team, workspace, space) or a context
 * (a project, board, document).
 *
 * # Order
 *
 *   1. `metadataName` — the replicated record (`GroupMetadataSet` /
 *      `ContextMetadataSet`). Every member and every device sees it. Wins.
 *   2. `listedName`   — whatever a listing already carried, for older nodes.
 *   3. `localName`    — this browser's label (the name typed at create, or the
 *      one an invitation carried), until the record has synced.
 *   4. `fallback`     — a readable stand-in, never 64 hex.
 */
export interface GroupNameSources {
  metadataName?: string | null;
  listedName?: string | null;
  localName?: string | null;
  fallback: string;
}

const clean = (v: string | null | undefined): string => (v ?? "").trim();

export function resolveGroupName(s: GroupNameSources): string {
  return clean(s.metadataName) || clean(s.listedName) || clean(s.localName) || s.fallback;
}

/** `Team fb884a` — the stand-in for a group nobody has named. */
export function placeholderName(noun: string, id: string | null | undefined): string {
  const short = clean(id).slice(0, 6);
  return short ? `${noun} ${short}` : noun;
}

type Fetched = { name: string | null; at: number };
const groupCache = new Map<string, Fetched>();
const inflight = new Map<string, Promise<string | null | undefined>>();
const GROUP_TTL_MS = 60_000;

/**
 * The replicated name of a group, or of a context when `contextId` is given.
 *
 * `null` when the record has no name, `undefined` when the node could not say
 * — the two differ for a caller deciding whether to write one. Cached and
 * deduplicated so every card on a page asking costs one request.
 */
export function fetchGroupName(
  admin: NamesAdmin,
  groupId: string,
  contextId?: string,
): Promise<string | null | undefined> {
  const key = contextId ? `${groupId}/${contextId}` : groupId;
  const hit = groupCache.get(key);
  if (hit && Date.now() - hit.at < GROUP_TTL_MS) return Promise.resolve(hit.name);
  const running = inflight.get(key);
  if (running) return running;

  const read = contextId ? admin.getContextMetadata : admin.getGroupMetadata;
  if (!read) return Promise.resolve(undefined);
  const p = Promise.resolve()
    .then(() =>
      contextId ? admin.getContextMetadata!(groupId, contextId) : admin.getGroupMetadata!(groupId),
    )
    .then((rec) => {
      const name = clean(rec?.name) || null;
      groupCache.set(key, { name, at: Date.now() });
      return name;
    })
    // Unreadable is not "unnamed": keep what was known, and ask again next time.
    .catch(() => (hit ? hit.name : undefined))
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * Write `name` into a group's record if it still has none.
 *
 * The record is re-read first, because a write replaces it whole: its `data`
 * map is passed back rather than wiped, and a name someone set in the meantime
 * is left alone.
 */
export async function backfillGroupName(admin: NamesAdmin, groupId: string, name: string): Promise<void> {
  const trimmed = clean(name);
  if (!trimmed || !admin.getGroupMetadata || !admin.setGroupMetadata) return;
  const current = (await admin.getGroupMetadata(groupId)) as
    | { name?: string | null; data?: Record<string, string> }
    | null;
  if (clean(current?.name)) return;
  await admin.setGroupMetadata(groupId, {
    name: trimmed,
    ...(current?.data && Object.keys(current.data).length > 0 ? { data: current.data } : {}),
  });
  rememberGroupName(groupId, trimmed);
}

/** Seed the cache after this session renamed a group, so it shows at once. */
export function rememberGroupName(groupId: string, name: string, contextId?: string): void {
  const key = contextId ? `${groupId}/${contextId}` : groupId;
  groupCache.set(key, { name: clean(name) || null, at: Date.now() });
}

/** Forget cached group names, e.g. after a rename. */
export function invalidateGroupName(groupId?: string): void {
  if (!groupId) {
    groupCache.clear();
    return;
  }
  for (const key of groupCache.keys()) if (key === groupId || key.startsWith(`${groupId}/`)) groupCache.delete(key);
}
