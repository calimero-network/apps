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

import { setSessionApplicationId } from './appId';
import { setMeroInstance, signClientOf } from './node';

export function MeroBridge() {
  const { mero, admin, isDelegated, applicationId } = useMero();
  useEffect(() => {
    setMeroInstance(signClientOf(mero, admin));
    // Cleared on unmount so a torn-down provider cannot leave a stale client
    // answering calls against a connection that is gone.
    return () => setMeroInstance(null);
  }, [mero, admin]);
  useEffect(() => {
    // An account cannot list installed applications (the route is a node's
    // own), so the id mero-react resolved from the registry is the answer for
    // every non-hook caller of `resolveApplicationId`. A node login keeps
    // asking the node, which is the only source that is right per install.
    setSessionApplicationId(isDelegated ? applicationId : null);
    return () => setSessionApplicationId(null);
  }, [isDelegated, applicationId]);
  return null;
}
