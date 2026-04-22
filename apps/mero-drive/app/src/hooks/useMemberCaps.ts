// Shared cap-fetching effect for the namespace + folder permission
// hooks. Both hooks resolve the caller's identity for a namespace,
// then query `/groups/:groupId/members/:identity` for the capability
// bitmask — the only difference is which group they ask about. This
// helper folds the duplicate effect into one place so the guard +
// reset + alive-flag invariants stay in sync.
//
// Returns:
//   - `caps = null`  → loading (initial state, pending fetch, or
//                      missing prerequisites like a falsy groupId)
//   - `caps = 0`     → fetch errored (caller treats as "no bits")
//   - `caps > 0`     → actual bitmask from admin-API
//
// The `setCaps(null)` resets on re-run are load-bearing:
//   1. First reset (falsy prereq branch) keeps the hook in loading
//      state during bootstrap before groupId / identity resolve.
//      Without it, empty-string groupId would fire an adminRequest
//      against `/groups//members/…` that 404s and buckets into the
//      catch as caps=0, briefly showing "all denied" with
//      loading:false.
//   2. Second reset (happy-path top of effect) clears the previous
//      group's caps before the new fetch resolves. Without it,
//      switching from an admin folder to a read-only folder briefly
//      renders admin affordances (delete, rename, visibility toggle)
//      because the stale caps stay in state with loading:false.

import { useEffect, useState } from 'react';
import { adminRequest } from '../api/adminApi';
import { useSelfIdentity } from './useSelfIdentity';

export function useMemberCaps(
  namespaceId: string,
  groupId: string,
): number | null {
  const { identity } = useSelfIdentity(namespaceId);
  const [caps, setCaps] = useState<number | null>(null);

  useEffect(() => {
    if (!identity || !groupId) {
      setCaps(null);
      return;
    }
    setCaps(null);
    let alive = true;
    adminRequest<{ capabilities: number }>(`/groups/${groupId}/members/${identity}`)
      .then((r) => {
        if (alive) setCaps(r.capabilities);
      })
      .catch(() => {
        if (alive) setCaps(0);
      });
    return () => {
      alive = false;
    };
  }, [groupId, identity]);

  return caps;
}
