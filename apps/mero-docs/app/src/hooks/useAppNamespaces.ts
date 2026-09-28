// The node's workspaces for this app, plus whether that list is a real answer.
// mero-react's hook reads "not loading" with an empty list before its first read.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMero, type Namespace } from '@calimero-network/mero-react';

const NONE: Namespace[] = []; // one empty list, so an unlisted read keeps a stable identity
const PAGE_SIZE = 100; // core's default page; a full page means there may be more

type Mero = NonNullable<ReturnType<typeof useMero>['mero']>;

/** Every page of the node's list: core answers one id-ordered page per request. */
async function listAllNamespaces(
  mero: Mero,
  applicationId: string,
): Promise<Namespace[]> {
  const byId = new Map<string, Namespace>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    // mero-js takes no paging options here, so the query rides on the id segment.
    const page = await mero.admin.listNamespacesForApplication(
      `${applicationId}?offset=${offset}&limit=${PAGE_SIZE}`,
    );
    // A create between two reads shifts the pages, so one row can arrive twice.
    for (const ns of page) byId.set(ns.namespaceId, ns);
    if (page.length < PAGE_SIZE) return [...byId.values()];
  }
}

export function useAppNamespaces(applicationId: string | null) {
  const { mero } = useMero();
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
    if (!mero || !applicationId) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const namespaces = await listAllNamespaces(mero, applicationId);
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
    /** The latest successful read; a failed re-read keeps it. */
    namespaces: forThisApp ? read.namespaces : NONE,
    /** True once any read for this app id has succeeded. */
    listed: forThisApp,
    loading,
    error,
    refetch,
  };
}
