// Memoized MeroDocsClient factory - same shape as useRegistryClient but
// scoped to a folder's docs context rather than the namespace-wide
// registry. Returns null until all three inputs resolve so consumers
// can gate rendering on the client being ready.

import { useMemo } from 'react';
import { useMero } from '@/calimero/react';
import { MeroDocsClient } from '@/lib/docsApi';

export function useDocsClient(
  docsContextId: string | null,
  executorPublicKey: string | null,
): MeroDocsClient | null {
  const { mero } = useMero();
  return useMemo(() => {
    if (!mero || !docsContextId || !executorPublicKey) return null;
    return new MeroDocsClient(mero.client, docsContextId);
  }, [mero, docsContextId, executorPublicKey]);
}
