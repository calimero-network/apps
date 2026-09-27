// The node's workspaces for this app, plus whether that list is a real answer.
// mero-react's hook reads "not loading" with an empty list before its first read.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMero, type Namespace } from '@calimero-network/mero-react';

const NONE: Namespace[] = []; // one empty list, so an unlisted read keeps a stable identity

export function useAppNamespaces(applicationId: string | null) {
  const { mero } = useMero();
  const [read, setRead] = useState<{ appId: string; namespaces: Namespace[] } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const seqRef = useRef(0);

  const refetch = useCallback(async () => {
    const seq = ++seqRef.current;
    const current = () => seqRef.current === seq;
    if (!mero || !applicationId) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const namespaces = await mero.admin.listNamespacesForApplication(applicationId);
      if (current()) setRead({ appId: applicationId, namespaces });
    } catch (e: unknown) {
      if (current()) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (current()) setLoading(false);
    }
  }, [mero, applicationId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const forThisApp = !!applicationId && read?.appId === applicationId;
  return {
    namespaces: forThisApp ? read.namespaces : NONE,
    /** True once a read for this app id succeeded and the latest read did not fail. */
    listed: forThisApp && !error,
    loading,
    error,
    refetch,
  };
}
