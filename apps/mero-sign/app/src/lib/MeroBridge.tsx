/**
 * Hands the live `mero` instance to the module-level clients in `lib/node`.
 *
 * The services and data sources in `src/api/` are plain classes, not hooks —
 * they import `apiClient`/`blobClient` at module scope, exactly as they did
 * from the old SDK. Something under `MeroProvider` has to give those the
 * instance, and a component that renders nothing is the smallest thing that
 * can: it sees the context, and it re-registers if the connection changes.
 */
import { useEffect } from 'react';
import { useMero } from '@calimero-network/mero-react';

import { setMeroInstance } from './node';

export function MeroBridge() {
  const { mero } = useMero();
  useEffect(() => {
    setMeroInstance(mero ?? null);
    // Cleared on unmount so a torn-down provider cannot leave a stale client
    // answering calls against a connection that is gone.
    return () => setMeroInstance(null);
  }, [mero]);
  return null;
}
