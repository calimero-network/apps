// Shared cap-fetching effect for the namespace + folder permission
// hooks. Both hooks resolve the caller's identity for a namespace,
// then query `/groups/:groupId/members/:identity` for the capability
// bitmask — the only difference is which group they ask about. This
// helper folds the duplicate effect into one place so the guard +
// reset + alive-flag invariants stay in sync.
//
// Returns `{ caps, error }`:
//   - `caps = null, error = null` → loading (initial state, pending
//     fetch, or missing prerequisites like a falsy groupId).
//   - `caps = 0,    error = null` → resolved with zero bits (member
//     with no granted capabilities).
//   - `caps > 0,    error = null` → actual bitmask from admin-API.
//   - `caps = 0,    error = Error` → fetch failed. Callers can
//     distinguish this from a legitimate zero bitmask to show a
//     retry affordance instead of silently rendering as denied.
//
// The `setState({caps: null, ...})` resets on re-run are load-bearing:
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

export interface MemberCapsState {
  caps: number | null;
  error: Error | null;
}

export function useMemberCaps(
  namespaceId: string,
  groupId: string,
): MemberCapsState {
  const { identity, error: identityError } = useSelfIdentity(namespaceId);
  const [state, setState] = useState<MemberCapsState>({
    caps: null,
    error: null,
  });

  useEffect(() => {
    // Propagate identity fetch failures. Without this, a failed
    // /namespaces/:ns/self-identity call leaves `identity` null, which
    // would fall into the falsy-prereq branch below and render
    // `loading: true, error: null` forever — the exact silent-stuck
    // state the error field was added to prevent.
    if (identityError) {
      setState({ caps: 0, error: identityError });
      return;
    }
    if (!identity || !groupId) {
      setState({ caps: null, error: null });
      return;
    }
    setState({ caps: null, error: null });
    let alive = true;
    adminRequest<{ capabilities: number }>(`/groups/${groupId}/members/${identity}`)
      .then((r) => {
        if (alive) setState({ caps: r.capabilities, error: null });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const err = e instanceof Error ? e : new Error(String(e));
        setState({ caps: 0, error: err });
      });
    return () => {
      alive = false;
    };
  }, [groupId, identity, identityError]);

  return state;
}
