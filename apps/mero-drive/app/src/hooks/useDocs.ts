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
import { useRegistry } from '../context/RegistryContext';
import { useWorkspace } from '../context/WorkspaceContext';
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

export function useDocs(folderId: string | null): UseDocsState {
  const { namespaceId } = useWorkspace();
  const { identity } = useSelfIdentity(namespaceId);
  const { registryClient } = useRegistry();

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
  // remote creates/edits/deletes without polling.
  useDocEvents(contextId, () => {
    void refetch();
  });

  const create = useCallback(
    async (input: { title: string; content?: string }): Promise<string> => {
      if (!docsClient) throw new Error('docs context not ready');
      const id = await docsClient.createDoc({
        title: input.title,
        content: input.content ?? '',
      });
      await refetch();
      return id;
    },
    [docsClient, refetch],
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
      // Intentionally no refetch — the caller (DocumentEditor)
      // manages its own per-doc state and would refetch via
      // useDocEvents anyway. Autosaves would otherwise flicker the
      // list on every keystroke.
    },
    [docsClient],
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
    },
    [docsClient, refetch],
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
