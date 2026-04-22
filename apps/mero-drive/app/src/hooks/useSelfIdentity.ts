// Per-namespace self-identity cache. The node issues a distinct
// public key per namespace membership, and every permission hook
// needs it as the subject in admin-API member lookups. Identity is
// stable for the session, so we cache in localStorage keyed by
// namespace id — invalidation is per-namespace, so switching
// namespaces doesn't blow away the whole cache.
//
// Session boundary: the cache is NOT scoped by authenticated user.
// Callers must invoke `clearIdentityCache()` on logout — otherwise a
// second user signing in on the same browser would inherit the
// previous user's pubkey.

import { useEffect, useState } from 'react';
import { adminRequest } from '../api/adminApi';

export interface SelfIdentityState {
  identity: string | null;
  loading: boolean;
  error: Error | null;
}

const KEY_PREFIX = 'mero-drive:selfId:';
const keyFor = (ns: string) => `${KEY_PREFIX}${ns}`;

// Clear every per-namespace identity entry. Call on logout so a
// second user signing in on the same browser doesn't inherit the
// previous user's pubkey from cache — the cache is scoped by
// namespace, not by authenticated user, so session-bounded clearing
// has to happen explicitly.
export function clearIdentityCache(): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(KEY_PREFIX)) toRemove.push(k);
  }
  for (const k of toRemove) localStorage.removeItem(k);
}

export function useSelfIdentity(namespaceId: string | null): SelfIdentityState {
  const [state, setState] = useState<SelfIdentityState>({
    identity: null,
    loading: !!namespaceId,
    error: null,
  });

  useEffect(() => {
    if (!namespaceId) {
      setState({ identity: null, loading: false, error: null });
      return;
    }
    const cached = localStorage.getItem(keyFor(namespaceId));
    if (cached) {
      setState({ identity: cached, loading: false, error: null });
      return;
    }
    // Reset synchronously before the fetch. Without this, switching
    // namespaces would briefly surface the previous namespace's
    // identity with `loading: false`, and downstream permission hooks
    // (which use identity as the member key) would query the wrong
    // member during the gap.
    setState({ identity: null, loading: true, error: null });
    let alive = true;
    adminRequest<{ identity: string }>(`/namespaces/${namespaceId}/self-identity`)
      .then((r) => {
        if (!alive) return;
        localStorage.setItem(keyFor(namespaceId), r.identity);
        setState({ identity: r.identity, loading: false, error: null });
      })
      .catch((e) => {
        if (alive) setState({ identity: null, loading: false, error: e });
      });
    return () => {
      alive = false;
    };
  }, [namespaceId]);

  return state;
}
