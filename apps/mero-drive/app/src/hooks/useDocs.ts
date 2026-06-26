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
import { useJoinContext } from '@calimero-network/mero-react';
import { CalimeroBytes, type DocDto } from '../api/docs/DocsClient';
import { useDriveWorkspace } from '../hooks/useDriveWorkspace';
import { useSelfIdentity } from './useSelfIdentity';
import { useDocsClient } from './useDocsClient';
import { useDocEvents } from './useDocEvents';

export interface UseDocsState {
  /** The docs context id bound to this folder (null until resolved). */
  contextId: string | null;
  /** True while `getFolderContext` is in flight — distinguishes
   *  "registry hasn't told us about this folder yet" (transient,
   *  show a syncing message) from "folder genuinely has no binding"
   *  (legacy / unbound state, show the static empty copy). */
  contextResolving: boolean;
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
  /** Append one opaque Yjs update blob to a doc's collaborative content log.
   *  Idempotent (content-addressed in the WASM). Used by the Yjs provider. */
  appendUpdate: (id: string, update: Uint8Array) => Promise<void>;
  /** Read the full (unordered) set of Yjs update blobs for a doc. */
  getUpdates: (id: string) => Promise<Uint8Array[]>;
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

// core's `execute` (jsonrpc/execute.rs) rejects with this when the
// node holds no owned `ContextIdentity` for the target context.
//
// IMPORTANT — error shape: mero-js throws the JSON-RPC error as
// `new E(code, message, data, type)`. For a FunctionCallError there
// is no `error.message` on the wire, so `message` becomes the error
// TYPE ("FunctionCallError") and the human string ("No owned
// identity…") lands in `.data`. A predicate that only scans
// `.message` silently misses it — so scan `data`/`type` too.
function isMissingOwnedIdentityError(err: unknown): boolean {
  if (err == null) return false;
  const parts: string[] = [];
  if (err instanceof Error && err.message) parts.push(err.message);
  if (typeof err === 'object' && err !== null) {
    const o = err as Record<string, unknown>;
    for (const key of ['data', 'type', 'bodyText']) {
      if (typeof o[key] === 'string') parts.push(o[key] as string);
    }
  }
  if (parts.length === 0) parts.push(String(err));
  return /no owned identity/i.test(parts.join(' | '));
}

export function useDocs(folderId: string | null): UseDocsState {
  const { namespaceId, registryClient } = useDriveWorkspace();
  const { identity } = useSelfIdentity(namespaceId);
  const { joinContext } = useJoinContext();
  // Ref-captured so it isn't a `refetch` dependency — useJoinContext's
  // returned fn isn't guaranteed stable, and `refetch` feeds an effect.
  const joinContextRef = useRef(joinContext);
  joinContextRef.current = joinContext;
  // Caps the docs-context self-heal at one attempt per context (see
  // `refetch`) so a persistently-failing join can't loop.
  const healedContextRef = useRef<string | null>(null);

  const [contextId, setContextId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<Error | null>(null);
  // True while getFolderContext is in flight for the current
  // (registryClient, folderId). Set false on settle (success OR
  // error) so the UI can tell "transient — wait for sync" apart
  // from "settled to null — folder has no binding".
  //
  // Initial value derives from props directly so the very first
  // paint of DocumentList already sees `contextResolving=true`
  // when there's work pending. Without this, the useEffect runs
  // post-paint and the legacy "no docs context bound yet" copy
  // flashes for a frame.
  const [contextResolving, setContextResolving] = useState<boolean>(
    () => !!registryClient && !!folderId,
  );

  // Resolve the docs context id for this folder. The registry's
  // folder-context binding is authoritative; if it's missing (legacy
  // folders pre-Phase-7), the hook surfaces contextId=null and
  // loading=false rather than retrying — the UI decides whether to
  // show an empty-state or force a reconcile.
  useEffect(() => {
    if (!registryClient || !folderId) {
      setContextId(null);
      setResolveError(null);
      setContextResolving(false);
      return;
    }
    let alive = true;
    setContextId(null);
    setResolveError(null);
    setContextResolving(true);
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
      })
      .finally(() => {
        if (alive) setContextResolving(false);
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
  // Last rendered list signature — lets refetch skip a no-op setList when
  // an SSE-driven refetch returns visually-identical data (diff-guard).
  const lastListSigRef = useRef<string>('');

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
      let result: DocDto[];
      try {
        result = await docsClient.listDocs({ include_archived: false });
      } catch (e) {
        // Self-heal. A node can be a folder-SUBGROUP member without an
        // owned identity in the docs CONTEXT: core's join-via-
        // inheritance is subgroup-scoped and never provisions a
        // child-context `ContextIdentity` (see RestrictedFolderCard +
        // core `join_context.rs`). RestrictedFolderCard joins the
        // context proactively, but that card only renders for non-
        // members — a node that became a subgroup member by any other
        // path (or before that card existed) has no way to trigger the
        // context join. So when `list_docs` reports the missing
        // identity, join the docs context once and retry. core's
        // join_context persists the identity, so this heal runs at
        // most once per context per node, ever.
        if (
          contextId &&
          healedContextRef.current !== contextId &&
          isMissingOwnedIdentityError(e)
        ) {
          healedContextRef.current = contextId;
          // One-time recovery breadcrumb. If `joinContext` throws it
          // propagates to the outer catch and surfaces as `error`,
          // same as any other list failure.
          console.warn(
            '[useDocs] docs context has no owned identity — ' +
              'self-healing via joinContext',
            contextId,
          );
          await joinContextRef.current(contextId);
          result = await docsClient.listDocs({ include_archived: false });
        } else {
          throw e;
        }
      }
      // Sort most-recent first so the list's default cursor lands
      // on what the user likely wants to read.
      result.sort((a, b) => b.updated_at - a.updated_at);
      // Diff-guard: only push new state when the rendered signature differs, so
      // the sidebar doesn't flicker on every SSE event. Deliberately EXCLUDES
      // updated_at — the list shows title + structure, not timestamps, so a
      // remote CONTENT edit (which only bumps updated_at) must NOT re-render
      // the other window's folder pane. Structural changes (create / delete /
      // rename / archive) still change the signature and refresh. Trade-off:
      // most-recent-first order re-sorts on the next structural change, not live
      // on content edits — the desired stable behaviour.
      const sig = result
        .map((d) => `${d.id}:${d.title}:${d.archived ? 1 : 0}`)
        .join('|');
      if (sig !== lastListSigRef.current) {
        lastListSigRef.current = sig;
        setList(result);
      }
      setListLoading(false);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setListError(err);
      setListLoading(false);
    } finally {
      inFlightRef.current = false;
    }
  }, [docsClient, contextId]);

  useEffect(() => {
    setListLoading(true);
    void refetch();
  }, [refetch]);

  // Refresh on SSE events from the docs context — covers remote
  // creates/edits/deletes without polling. DEBOUNCED: the context emits
  // an event on every edit_doc, including the writer's OWN ~900ms
  // autosaves, so a 1:1 refetch makes the sidebar list re-fetch and
  // re-sort (by updated_at) on every keystroke-burst — visible as
  // constant flicker. A trailing debounce collapses a burst into one
  // quiet refetch after activity settles. Explicit mutations (create /
  // delete / rename) bypass this and refetch immediately via
  // notifyDocsRefetch, so user-initiated changes still feel instant.
  //
  // Wrapped in useCallback so useDocEvents' downstream useSubscription
  // doesn't tear down and re-establish the SSE connection on every
  // consumer re-render (each saveStatus update in DocumentEditor would
  // otherwise churn the subscription).
  const sseRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDocsEvent = useCallback(() => {
    if (sseRefetchTimerRef.current) clearTimeout(sseRefetchTimerRef.current);
    sseRefetchTimerRef.current = setTimeout(() => {
      sseRefetchTimerRef.current = null;
      void refetch();
    }, 1000);
  }, [refetch]);
  useDocEvents(contextId, onDocsEvent);
  // Clear any pending debounced refetch on unmount / context change so a
  // late timer can't fire a refetch against a torn-down client.
  useEffect(() => {
    return () => {
      if (sseRefetchTimerRef.current) {
        clearTimeout(sseRefetchTimerRef.current);
        sseRefetchTimerRef.current = null;
      }
    };
  }, []);

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

  const appendUpdate = useCallback(
    async (id: string, update: Uint8Array): Promise<void> => {
      if (!docsClient) throw new Error('docs context not ready');
      // Deliberately does NOT notify siblings: the sidebar renders title, not
      // body, so a list_docs fan-out per update would only add load. Peers
      // learn of the new blob via the docs-context SSE event (DocEdited) the
      // collab provider's pullRemote consumes.
      await docsClient.appendDocUpdate({
        id,
        update: CalimeroBytes.fromUint8Array(update),
      });
    },
    [docsClient],
  );

  const getUpdates = useCallback(
    async (id: string): Promise<Uint8Array[]> => {
      if (!docsClient) throw new Error('docs context not ready');
      const blobs = await docsClient.getDocUpdates({ id });
      // The generated DocsClient's convertWasmResultToCalimeroBytes tests
      // `arr.every(isNumber)`, which is VACUOUSLY TRUE for `[]` — so an empty
      // content_updates (a fresh doc) comes back as a single CalimeroBytes([])
      // rather than an empty array. A non-array result means "no updates". The
      // guard lives here because DocsClient is codegen'd (DO NOT EDIT).
      if (!Array.isArray(blobs)) return [];
      return blobs.map((b) => b.toUint8Array());
    },
    [docsClient],
  );

  return {
    contextId,
    contextResolving,
    list,
    loading: listLoading,
    error: resolveError ?? listError,
    refetch,
    create,
    edit,
    get,
    remove,
    appendUpdate,
    getUpdates,
  };
}
