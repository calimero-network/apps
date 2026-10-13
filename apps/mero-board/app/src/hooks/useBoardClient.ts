import { useMemo } from 'react';
import { useMero } from '@calimero-network/mero-react';
import { BoardClient } from '../generated/BoardClient';

/** Typed client for the active folder, null until context + identity resolve. */
export function useBoardClient(contextId: string | null, executorPublicKey: string | null): BoardClient | null {
  const { mero } = useMero();
  return useMemo(
    () => (mero && contextId && executorPublicKey ? new BoardClient(mero, contextId) : null),
    [mero, contextId, executorPublicKey],
  );
}
