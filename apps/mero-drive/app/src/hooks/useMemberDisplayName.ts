// Per-(namespace, member) display name backed by core's setMemberMetadata
// (PR #2338). Falls back to null when unset — callers should render a
// truncated pubkey as the visual fallback (see <MemberLabel>).
//
// Self-edit is always allowed by core; admin override is out of scope here.
//
// A tiny module-level cache keeps repeat lookups (same nsId+memberId across
// the page render tree) from re-fetching — useMemberMetadata is per-call,
// so a list of N members fans out to N requests on first paint without a
// shared layer. The cache holds just the name string (`null` when unset)
// so a follow-up render reading the same key sees the last-known value
// even if the underlying useMemberMetadata transitions through `loading`
// for a refetch. A setName() write invalidates the entry before triggering
// the refetch so we don't serve a stale name.
//
// NOTE: This is a "best-effort" cache — it is not a full subscription
// layer. Cache invalidation on remote updates (peer-driven rename
// events) is intentionally deferred; v1 refetches on setName + on mount,
// which covers the self-edit happy path.

import { useCallback, useMemo } from 'react';
import {
  useMemberMetadata,
  useSetMemberMetadata,
} from '@calimero-network/mero-react';
import { useDriveWorkspace } from './useDriveWorkspace';

const cache = new Map<string, string | null>();
const cacheKey = (nsId: string, memberId: string) => `${nsId}::${memberId}`;

/** @internal — for tests only */
export function __resetDisplayNameCache() {
  cache.clear();
}

export interface MemberDisplayName {
  /** Display name or null when none is set. */
  name: string | null;
  loading: boolean;
  error: Error | null;
  /** Sets the display name for `memberId` (defaults to the bound
   *  `memberId`, then `selfIdentity`). Throws if trimmed input is empty
   *  or no target identity is available. Rejects from the server are
   *  rethrown. */
  setName: (name: string, memberId?: string) => Promise<void>;
}

export function useMemberDisplayName(
  namespaceId: string | null | undefined,
  memberId: string | null | undefined,
): MemberDisplayName {
  const { selfIdentity } = useDriveWorkspace();
  const { metadata, loading, error, refetch } = useMemberMetadata(
    namespaceId ?? null,
    memberId ?? null,
  );
  const { setMemberMetadata } = useSetMemberMetadata();

  const name = useMemo(() => {
    const raw = metadata?.name ?? null;
    if (namespaceId && memberId) {
      cache.set(cacheKey(namespaceId, memberId), raw);
    }
    return raw;
  }, [metadata, namespaceId, memberId]);

  const setName = useCallback(
    async (next: string, mid?: string) => {
      const trimmed = next.trim();
      if (!trimmed) throw new Error('display name cannot be empty');
      if (!namespaceId) throw new Error('namespaceId required');
      const target = mid ?? memberId ?? selfIdentity;
      if (!target) throw new Error('memberId required');
      await setMemberMetadata(namespaceId, target, {
        name: trimmed,
        data: {},
      });
      cache.delete(cacheKey(namespaceId, target));
      await refetch();
    },
    [namespaceId, memberId, selfIdentity, setMemberMetadata, refetch],
  );

  return { name, loading, error, setName };
}
