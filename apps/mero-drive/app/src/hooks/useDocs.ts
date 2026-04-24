// Docs facade for a single folder — resolves the folder's bound
// docs context via the registry, instantiates a DocsClient against
// it, and exposes list / get / create / edit / delete + SSE-driven
// refresh. Consumers pass a folderId and get a reactive list of
// docs plus a typed set of mutations.
//
// Split of responsibilities:
//   - RegistryClient.getFolderContext → resolve the docs context id
//   - useDocsClient → instantiate the generated client with MeroJs
//     + contextId + executor pubkey
//   - useSubscription-backed useDocEvents → invalidate the list on
//     remote changes (other peers creating / editing / deleting)
//
// Caller patterns:
//   const docs = useDocs(folderId);
//   const byId = useMemo(() => new Map(docs.list.map(d => [d.id, d])), [docs.list]);

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocDto } from '../api/docs/DocsClient';
import { useDriveWorkspace } from '../hooks/useDriveWorkspace';
import { useSelfIdentity } from './useSelfIdentity';
import { useDocsClient } from './useDocsClient';
import { useDocEvents } from './useDocEvents';

export interface UseDocsState {
  /** The docs context id bound to this folder (null until resolved). */
  contextId: string | null;
  /** Non-archived docs in the folder (sorted by updated_at desc). */
  list: DocDto[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  create: (input: { title: string; content?: string }) => Promise<string>;
  edit: (
    id: string,
    patch: { title?: string | null; content?: string | null },
  ) => Promise<void>;
  get: (id: string) => Promise<DocDto>;
  remove: (id: string) => Promise<void>;
}

// Module-level fan-out so every useDocs instance for the same
// contextId re-reads the list when ANY instance mutates a doc.
// Without this, DocumentEditor saves update its own state but the
// sidebar's DocumentList stays stale until the page reloads — the
// SSE path via useDocEvents is supposed to cover this but isn't
// firing reliably in dev. A module-level pub/sub is a safe
// complement: on mutation, both the SSE event (when it works) and
// the explicit notification trigger a refetch — refetch itself is
// guarded by inFlightRef so duplicate triggers collapse to one fetch.
const docsRefetchersByContext = new Map<string, Set<() => void>>();
function subscribeDocsRefetch(contextId: string, fn: () => void): () => void {
  let bucket = docsRefetchersByContext.get(contextId);
  if (!bucket) {
    bucket = new Set();
    docsRefetchersByContext.set(contextId, bucket);
  }
  bucket.add(fn);
  return () => {
    bucket?.delete(fn);
    if (bucket && bucket.size === 0) {
      docsRefetchersByContext.delete(contextId);
    }
  };
}
function notifyDocsRefetch(contextId: string | null) {
  if (!contextId) return;
  const bucket = docsRefetchersByContext.get(contextId);
  if (!bucket) return;
  for (const fn of bucket) fn();
}

export function useDocs(folderId: string | null): UseDocsState {
  const { namespaceId } = useDriveWorkspace();
  const { identity } = useSelfIdentity(namespaceId);
  const { registryClient } = useDriveWorkspace();

  const [contextId, setContextId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<Error | null>(null);

  // Resolve the docs context id for this folder. The registry's
  // folder-context binding is authoritative; if it's missing (legacy
  // folders pre-Phase-7), the hook surfaces contextId=null and
  // loading=false rather than retrying — the UI decides whether to
  // show an empty-state or force a reconcile.
  useEffect(() => {
    if (!registryClient || !folderId) {
      setContextId(null);
      setResolveError(null);
      return;
    }
    let alive = true;
    setContextId(null);
    setResolveError(null);
    registryClient
      .getFolderContext({ folder_id: folderId })
      .then((ctxId) => {
        if (alive) setContextId(ctxId ?? null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const err = e instanceof Error ? e : new Error(String(e));
        setResolveError(err);
        setContextId(null);
      });
    return () => {
      alive = false;
    };
  }, [registryClient, folderId]);

  const docsClient = useDocsClient(contextId, identity);

  const [list, setList] = useState<DocDto[]>([]);
  const [listLoading, setListLoading] = useState<boolean>(true);
  const [listError, setListError] = useState<Error | null>(null);
  // Guards `refetch` from double-fetching under Strict Mode
  // double-mount + useDocEvents firing on the same tick.
  const inFlightRef = useRef(false);

  const refetch = useCallback(async () => {
    if (!docsClient) {
      setList([]);
      setListLoading(false);
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setListError(null);
    try {
      const result = await docsClient.listDocs({ include_archived: false });
      // Sort most-recent first so the list's default cursor lands
      // on what the user likely wants to read.
      result.sort((a, b) => b.updated_at - a.updated_at);
      setList(result);
      setListLoading(false);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setListError(err);
      setListLoading(false);
    } finally {
      inFlightRef.current = false;
    }
  }, [docsClient]);

  useEffect(() => {
    setListLoading(true);
    void refetch();
  }, [refetch]);

  // Refresh on every SSE event from the docs context — covers
  // remote creates/edits/deletes without polling. Wrapped in
  // useCallback so useDocEvents' downstream useSubscription
  // doesn't tear down and re-establish the SSE connection on
  // every consumer re-render (each saveStatus update in
  // DocumentEditor would otherwise churn the subscription).
  const onDocsEvent = useCallback(() => {
    void refetch();
  }, [refetch]);
  useDocEvents(contextId, onDocsEvent);

  // Cross-instance refresh — when any other useDocs instance for the
  // same docs context mutates, re-read our list too. See the
  // docsRefetchersByContext comment above.
  useEffect(() => {
    if (!contextId) return;
    const unsubscribe = subscribeDocsRefetch(contextId, () => {
      void refetch();
    });
    return unsubscribe;
  }, [contextId, refetch]);

  const create = useCallback(
    async (input: { title: string; content?: string }): Promise<string> => {
      if (!docsClient) throw new Error('docs context not ready');
      const id = await docsClient.createDoc({
        title: input.title,
        content: input.content ?? '',
      });
      await refetch();
      notifyDocsRefetch(contextId);
      return id;
    },
    [docsClient, refetch, contextId],
  );

  const edit = useCallback(
    async (
      id: string,
      patch: { title?: string | null; content?: string | null },
    ): Promise<void> => {
      if (!docsClient) throw new Error('docs context not ready');
      await docsClient.editDoc({
        id,
        title: patch.title ?? null,
        content: patch.content ?? null,
      });
      // Only notify siblings when something the list renders actually
      // changed. The sidebar shows title + timestamp but NOT content —
      // so content autosaves (by far the most frequent edits) don't
      // need to fan out. Notifying on every keystroke would trigger a
      // list_docs refetch per autosave, compounding with other
      // in-flight requests and starving edit_doc enough to make it
      // look stuck on "Saving…".
      const titleChanged = patch.title !== undefined && patch.title !== null;
      if (titleChanged) {
        notifyDocsRefetch(contextId);
      }
    },
    [docsClient, contextId],
  );

  const get = useCallback(
    async (id: string): Promise<DocDto> => {
      if (!docsClient) throw new Error('docs context not ready');
      return docsClient.getDoc({ id });
    },
    [docsClient],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (!docsClient) throw new Error('docs context not ready');
      await docsClient.deleteDoc({ id });
      await refetch();
      notifyDocsRefetch(contextId);
    },
    [docsClient, refetch, contextId],
  );

  return {
    contextId,
    list,
    loading: listLoading,
    error: resolveError ?? listError,
    refetch,
    create,
    edit,
    get,
    remove,
  };
}
