// The session's workspaces for this app, plus whether that list is a real answer.
// mero-react's hook reads "not loading" with an empty list before its first read.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createBrowserHttpClient } from '@calimero-network/mero-js';
import { useMero, type Namespace } from '@calimero-network/mero-react';

const NONE: Namespace[] = []; // one empty list, so an unlisted read keeps a stable identity
const PAGE_SIZE = 100; // core's default page; a full page means there may be more

type Admin = NonNullable<ReturnType<typeof useMero>['admin']>;
type Mero = ReturnType<typeof useMero>['mero'];
/** The node's page of the list that starts at `offset`. */
type PageReader = (offset: number) => Promise<Namespace[]>;

/**
 * Pages after the first, read from the node itself with the session's bearer.
 *
 * mero-js (>= 25.0.5) encodes the id as one path segment and its
 * `listNamespacesForApplication` takes no paging options, so a query string
 * riding on the id reached core as part of the id (400 "Invalid application
 * id"). The page is named on the route instead, through mero-js's own HTTP
 * client on the same node. Null when the session is not a node login.
 */
function nodePageReader(nodeUrl: string | null, mero: Mero, applicationId: string): PageReader | null {
  if (!nodeUrl || !mero || !('getTokenData' in mero)) return null;
  const http = createBrowserHttpClient({
    baseUrl: nodeUrl,
    getAuthToken: async () => mero.getTokenData()?.access_token,
  });
  const route = `/admin-api/namespaces/for-application/${encodeURIComponent(applicationId)}`;
  return async (offset) =>
    (await http.get<{ data?: Namespace[] }>(`${route}?offset=${offset}&limit=${PAGE_SIZE}`))?.data ?? [];
}

/** Every page of the node's list: core answers one id-ordered page per request. */
async function listAllNamespaces(
  admin: Admin,
  applicationId: string,
  readPage: PageReader | null,
): Promise<Namespace[]> {
  const byId = new Map<string, Namespace>();
  // The first page through the session admin: core answers its first 100 rows
  // when no page is named.
  let page = await admin.listNamespacesForApplication(applicationId);
  for (let offset = PAGE_SIZE; ; offset += PAGE_SIZE) {
    // A create between two reads shifts the pages, so one row can arrive twice.
    for (const ns of page) byId.set(ns.namespaceId, ns);
    if (page.length < PAGE_SIZE || !readPage) return [...byId.values()];
    page = await readPage(offset);
  }
}

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
  const { admin, isDelegated, mero, nodeUrl } = useMero();
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
      // The account admin filters the account's own list on the application id
      // exactly, and that list is the whole answer, not a page of it.
      const namespaces = isDelegated
        ? await admin.listNamespacesForApplication(applicationId)
        : await listAllNamespaces(admin, applicationId, nodePageReader(nodeUrl, mero, applicationId));
      if (current()) setRead({ appId: applicationId, namespaces });
    } catch (e: unknown) {
      if (current()) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (current()) setLoading(false);
    }
  }, [admin, isDelegated, mero, nodeUrl, applicationId]);

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
