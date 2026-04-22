// Per-namespace self-identity cache. The node issues a distinct
// public key per namespace membership, and every permission hook
// needs it as the subject in admin-API member lookups. Identity is
// stable for the session, so we cache in localStorage keyed by
// namespace id — invalidation is per-namespace, so switching
// namespaces doesn't blow away the whole cache.

import { useEffect, useState } from 'react';
import { adminRequest } from '../api/adminApi';

export interface SelfIdentityState {
  identity: string | null;
  loading: boolean;
  error: Error | null;
}

const keyFor = (ns: string) => `mero-drive:selfId:${ns}`;

export function useSelfIdentity(namespaceId: string | null): SelfIdentityState {
  const [state, setState] = useState<SelfIdentityState>({
    identity: null,
    loading: !!namespaceId,
    error: null,
  });

  useEffect(() => {
    if (!namespaceId) return;
    const cached = localStorage.getItem(keyFor(namespaceId));
    if (cached) {
      setState({ identity: cached, loading: false, error: null });
      return;
    }
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
