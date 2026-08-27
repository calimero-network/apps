// Memoized RegistryClient factory. The generated class takes
// `(mero, contextId, executorPublicKey)` — we recreate only when
// one of those inputs changes. Callers obtain the per-namespace
// pubkey + Registry context id from useDriveWorkspace.
//
// NB. useDriveWorkspace already memoizes its own RegistryClient
// instance; direct callers of this hook are legacy and will be
// folded into the main hook in a future pass.

import { useMemo } from 'react';
import { useMero } from '@calimero-network/mero-react';
import { RegistryClient } from '../generated/registry/RegistryClient';

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
