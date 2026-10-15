import { canonicalAccount } from "./account";

/**
 * The slice of mero-js's `AdminApiClient` this package reads and writes.
 *
 * Structural, so an app passes `useMero().mero.admin` (or its own wrapper)
 * without this package pinning a mero-js version of its own.
 */
export interface NamesAdmin {
  listGroupMembers(groupId: string): Promise<unknown>;
  getGroupMetadata?(groupId: string): Promise<{ name?: string | null } | null>;
  setGroupMetadata?(groupId: string, request: { name?: string; data?: Record<string, string> }): Promise<void>;
  getContextMetadata?(groupId: string, contextId: string): Promise<{ name?: string | null } | null>;
  getMemberMetadata?(
    groupId: string,
    identity: string,
  ): Promise<{ name?: string | null; data?: Record<string, string> } | null>;
  setMemberMetadata?(
    groupId: string,
    identity: string,
    request: { name?: string; data?: Record<string, string> },
  ): Promise<void>;
}

/** How long a fetched member list answers before the next read refreshes it. */
export const NAMES_TTL_MS = 30_000;

interface Entry {
  names: Map<string, string>;
  fetchedAt: number;
  inflight: Promise<void> | null;
  /** Accounts renamed by this session that the listing may not show yet. */
  pending: Map<string, string>;
}

const emptyEntry = (): Entry => ({ names: new Map(), fetchedAt: 0, inflight: null, pending: new Map() });

/**
 * Member names for each namespace, keyed by canonical account.
 *
 * # Source of truth
 *
 * Namespace member metadata: keyed by account, set by that account, replicated
 * through governance, and returned as `name` on every `listGroupMembers` row.
 * It is the one name a person has across every app on the namespace, which is
 * why it is read from the NAMESPACE and not from a subgroup: member metadata is
 * per group, and only the namespace is a group everyone is in.
 *
 * One listing carries every name, so the whole list is cached and the next
 * hundred rows are answered from memory.
 */
export class MemberNameDirectory {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();

  constructor(private readonly ttlMs = NAMES_TTL_MS) {}

  /** The known name for `account` in `namespaceId`, without fetching. */
  peek(namespaceId: string | null | undefined, account: string | null | undefined): string | undefined {
    const key = canonicalAccount(account);
    if (!namespaceId || !key) return undefined;
    return this.entries.get(namespaceId)?.names.get(key);
  }

  /**
   * Make sure `namespaceId`'s names are loaded and fresh.
   *
   * Concurrent callers share one request. A failed load keeps whatever was
   * already known: a name that showed a second ago is still true.
   */
  load(admin: NamesAdmin, namespaceId: string, opts: { force?: boolean } = {}): Promise<void> {
    const entry = this.entries.get(namespaceId) ?? emptyEntry();
    this.entries.set(namespaceId, entry);
    if (entry.inflight) return entry.inflight;
    if (!opts.force && entry.fetchedAt && Date.now() - entry.fetchedAt < this.ttlMs) {
      return Promise.resolve();
    }

    entry.inflight = admin
      .listGroupMembers(namespaceId)
      .then((raw) => {
        const names = new Map<string, string>();
        for (const m of memberRows(raw)) {
          const key = canonicalAccount(m.identity);
          const name = (m.name ?? m.alias ?? "").trim();
          if (key && name) names.set(key, name);
        }
        // A rename this session published wins until the listing agrees
        // (see `remember`): a name that reverts for a poll reads as failed.
        for (const [key, name] of entry.pending) {
          if ((names.get(key) ?? "") === name) entry.pending.delete(key);
          else if (name) names.set(key, name);
          else names.delete(key);
        }
        entry.names = names;
        entry.fetchedAt = Date.now();
        this.emit();
      })
      .catch(() => {
        // Retry on the next read rather than caching the failure.
        entry.fetchedAt = 0;
      })
      .finally(() => {
        entry.inflight = null;
      });
    return entry.inflight;
  }

  /**
   * Record a name this session just published, ahead of the listing.
   *
   * The governance op takes a moment to apply; until the listing carries it,
   * this keeps the new name on screen instead of the old one or an id.
   */
  remember(namespaceId: string, account: string, name: string): void {
    const key = canonicalAccount(account);
    if (!key) return;
    const entry = this.entries.get(namespaceId) ?? emptyEntry();
    const trimmed = name.trim();
    if (trimmed) entry.names.set(key, trimmed);
    else entry.names.delete(key);
    entry.pending.set(key, trimmed);
    this.entries.set(namespaceId, entry);
    this.emit();
  }

  /** Forget a namespace (or every one) so the next read refetches. */
  invalidate(namespaceId?: string): void {
    if (namespaceId) {
      const entry = this.entries.get(namespaceId);
      if (entry) entry.fetchedAt = 0;
    } else {
      for (const entry of this.entries.values()) entry.fetchedAt = 0;
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Test seam. */
  clear(): void {
    this.entries.clear();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

interface MemberRow {
  identity?: string;
  name?: string | null;
  alias?: string | null;
}

/**
 * The rows of a member listing, whichever shape the node sent.
 *
 * Core has served a bare array, `{ members }` and `{ data }` at different
 * versions, and `alias` before it was renamed `name`.
 */
function memberRows(raw: unknown): MemberRow[] {
  if (Array.isArray(raw)) return raw as MemberRow[];
  const obj = raw as { members?: unknown; data?: unknown } | null;
  if (Array.isArray(obj?.members)) return obj.members as MemberRow[];
  if (Array.isArray(obj?.data)) return obj.data as MemberRow[];
  return [];
}

/** The directory every app shares, so one listing serves every view. */
export const memberNames = new MemberNameDirectory();

/**
 * Publish `name` as `account`'s name on the namespace.
 *
 * A member may always set their own metadata, so this needs no capability.
 * `setMemberMetadata` replaces the whole record, so the current `data` map is
 * read and passed back rather than wiped. Throws on failure; callers that
 * publish in the background should catch.
 */
export async function publishMemberName(
  admin: NamesAdmin,
  namespaceId: string,
  account: string,
  name: string,
): Promise<void> {
  if (!admin.setMemberMetadata) throw new Error("this session cannot set member metadata");
  const identity = canonicalAccount(account) ?? account;
  const current = await admin.getMemberMetadata?.(namespaceId, identity).catch(() => null);
  await admin.setMemberMetadata(namespaceId, identity, {
    name: name.trim(),
    ...(current?.data && Object.keys(current.data).length > 0 ? { data: current.data } : {}),
  });
  memberNames.remember(namespaceId, identity, name);
}
