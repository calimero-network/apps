// The session's workspaces for this app, plus whether that list is a real answer.
// mero-react's hook reads "not loading" with an empty list before its first read.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMero, type Namespace } from '@calimero-apps/cloud';

const NONE: Namespace[] = []; // one empty list, so an unlisted read keeps a stable identity

export function useAppNamespaces(applicationId: string | null) {
  // `admin`, NOT `mero.admin`. `mero` is the raw client, and on a delegated
  // (account) session its transport is the relay: `mero.admin
  // .listNamespacesForApplication` became `GET {relay}/admin-api/namespaces
  // /for-application/{appId}` with the account's bearer token. That listing is
  // node-wide, not caller-scoped, and an account's token carries only
  // `namespace:list-own` - a 403 ("Token does not carry the permissions this
  // route requires") that the workspace switcher showed as "Failed to load
  // workspaces". `admin` is the session-aware one: the node's own client on a
  // node login, and on an account the account admin, whose
  // `listNamespacesForApplication` is the account's own scoped list filtered
  // by application.
  //
  // On Calimero Cloud the list is the account's organizations that run this
  // app, answered whole: v1's paging through the node's own route is gone.
  const { admin } = useMero();
  const [read, setRead] = useState<{
    appId: string;
    namespaces: Namespace[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const seqRef = useRef(0);

  const refetch = useCallback(async () => {
    const seq = ++seqRef.current;
    const current = () => seqRef.current === seq;
    if (!admin || !applicationId) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const namespaces = await admin.listNamespacesForApplication(applicationId);
      if (current()) setRead({ appId: applicationId, namespaces });
    } catch (e: unknown) {
      if (current()) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (current()) setLoading(false);
    }
  }, [admin, applicationId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const forThisApp = !!applicationId && read?.appId === applicationId;
  return {
    /** The latest successful read; a failed re-read keeps it. */
    namespaces: forThisApp ? read.namespaces : NONE,
    /** True once any read for this app id has succeeded. */
    listed: forThisApp,
    loading,
    error,
    refetch,
  };
}
