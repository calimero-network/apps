// Memoized RegistryClient factory. The generated class takes
// `(mero, contextId, executorPublicKey)` — we recreate only when one
// of those inputs changes. Callers obtain the per-namespace pubkey
// from useSelfIdentity (or useNamespaceIdentity from mero-react),
// and the context id from useWorkspaceBootstrap.

import { useMemo } from 'react';
import { useMero } from '@calimero-network/mero-react';
import { RegistryClient } from '../api/registry/RegistryClient';

export function useRegistryClient(
  contextId: string | null,
  executorPublicKey: string | null,
): RegistryClient | null {
  const { mero } = useMero();
  return useMemo(() => {
    if (!mero || !contextId || !executorPublicKey) return null;
    return new RegistryClient(mero, contextId, executorPublicKey);
  }, [mero, contextId, executorPublicKey]);
}
