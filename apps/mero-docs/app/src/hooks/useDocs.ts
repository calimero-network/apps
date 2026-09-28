// Docs facade for a single folder - resolves the folder's bound
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
//   const forExistence = useDocs(folderId, { includeArchived: true });

import { useCallback, useEffect, useRef, useState } from 'react';
import { useJoinContext } from '@calimero-network/mero-react';
import type { DocDto, DocsClient } from '../generated/docs/DocsClient';
import { useDriveWorkspace } from '../hooks/useDriveWorkspace';
import { useDocsClient } from './useDocsClient';
import { useDocEvents } from './useDocEvents';
// `FolderId`/`ContextId` are BRANDED at abi-codegen 2: `string & {__brand}`.
// The generated constructor is the only way to make one, which is the point -
// this fleet has had folder ids, context ids and account ids all be bare
// 64-hex strings that type-check in each other's slots.
import { FolderId } from '../generated/registry/RegistryClient';

export interface UseDocsState {
  /** The docs context id bound to this folder (null until resolved). */
  contextId: string | null;
  /** True while `getFolderContext` is in flight - distinguishes
   *  "registry hasn't told us about this folder yet" (transient,
   *  show a syncing message) from "folder genuinely has no binding"
   *  (legacy / unbound state, show the static empty copy). */
  contextResolving: boolean;
  /** Docs in the folder (archived excluded unless requested), sorted by
   *  updated_at desc. */
  list: DocDto[];
  loading: boolean;
  /** True once `list` is a completed read for the current folder (a genuine
   *  empty binding, or a successful listDocs); false on a switch or error. */
  listed: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  create: (input: { title: string }) => Promise<string>;
  /** Replace the whole title. An open editor writes deltas through the
   *  title API instead; this is the rename path for the list. */
  edit: (id: string, patch: { title: string }) => Promise<void>;
  get: (id: string) => Promise<DocDto>;
  remove: (id: string) => Promise<void>;
  addTag: (id: string, tag: string) => Promise<void>;
  removeTag: (id: string, tag: string) => Promise<void>;
  archive: (id: string) => Promise<void>;
  unarchive: (id: string) => Promise<void>;
  /** The client bound to this folder's docs context, for the CRDT hooks. */
  client: DocsClient | null;
}

// Module-level fan-out so every useDocs instance for the same
// contextId re-reads the list when ANY instance mutates a doc.
// Without this, DocumentEditor saves update its own state but the
// sidebar's DocumentList stays stale until the page reloads - the
// SSE path via useDocEvents is supposed to cover this but isn't
// firing reliably in dev. A module-level pub/sub is a safe
// complement: on mutation, both the SSE event (when it works) and
// the explicit notification trigger a refetch - refetch itself is
// guarded by inFlightRef so duplicate triggers collapse to one fetch.
const docsRefetchersByContext = new Map<string, Set<() => void>>();
export function subscribeDocsRefetch(contextId: string, fn: () => void): () => void {
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
export function notifyDocsRefetch(contextId: string | null) {
  if (!contextId) return;
  const bucket = docsRefetchersByContext.get(contextId);
  if (!bucket) return;
  for (const fn of bucket) fn();
}

// One self-heal join per docs context at a time, shared by every instance
// that hits the missing identity together, so they never race each other.
const healsByContext = new Map<string, Promise<unknown>>();
function healContext(
  contextId: string,
  join: (id: string) => Promise<unknown>,
): Promise<unknown> {
  let heal = healsByContext.get(contextId);
  if (!heal) {
    heal = join(contextId).finally(() => healsByContext.delete(contextId));
    healsByContext.set(contextId, heal);
  }
  return heal;
}

// core's `execute` (jsonrpc/execute.rs) rejects with this when the
// node holds no owned `ContextIdentity` for the target context.
//
// IMPORTANT - error shape: mero-js throws the JSON-RPC error as
// `new E(code, message, data, type)`. For a FunctionCallError there
// is no `error.message` on the wire, so `message` becomes the error
// TYPE ("FunctionCallError") and the human string ("No owned
// identity…") lands in `.data`. A predicate that only scans
// `.message` silently misses it - so scan `data`/`type` too.
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

/** A folder's docs, joining its docs context when this node has no identity there
 *  yet; `joined` holds contexts already tried, so a second miss is an error. */
export async function listDocsJoining(
  client: DocsClient,
  contextId: string | null,
  includeArchived: boolean,
  join: (contextId: string) => Promise<unknown>,
  joined: Set<string>,
): Promise<DocDto[]> {
  try {
    return await client.listDocs({ include_archived: includeArchived });
  } catch (e) {
    // A node can be a folder-SUBGROUP member without an owned identity in the
    // docs CONTEXT: core's join-via-inheritance is subgroup-scoped.
    if (!contextId || joined.has(contextId) || !isMissingOwnedIdentityError(e))
      throw e;
    joined.add(contextId);
    console.warn('[listDocsJoining] no owned identity in docs context; joining', contextId);
    await healContext(contextId, join);
    return client.listDocs({ include_archived: includeArchived });
  }
}

export interface UseDocsOptions {
  /** Include archived docs in `list`, for an existence check, not display. */
  includeArchived?: boolean;
}

export function useDocs(
  folderId: string | null,
  opts?: UseDocsOptions,
): UseDocsState {
  const includeArchived = !!opts?.includeArchived;
  const { registryClient, selfIdentity: identity } = useDriveWorkspace();
  const { joinContext } = useJoinContext();
  // Ref-captured so it isn't a `refetch` dependency - useJoinContext's
  // returned fn isn't guaranteed stable, and `refetch` feeds an effect.
  const joinContextRef = useRef(joinContext);
  joinContextRef.current = joinContext;
  // Caps the docs-context self-heal at one attempt per context, so a
  // persistently-failing join can't loop.
  const healedContextsRef = useRef(new Set<string>());

  const [contextId, setContextId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<Error | null>(null);
  // True while getFolderContext is in flight; seeded from props so the first
  // paint already says "resolving" instead of flashing the unbound copy.
  const [contextResolving, setContextResolving] = useState<boolean>(
    () => !!registryClient && !!folderId,
  );
  // The folder whose context read last succeeded; a null contextId only
  // means "unbound" when this matches the current folder.
  const [resolvedFolder, setResolvedFolder] = useState<string | null>(null);
  // Bumped by an explicit retry after a failed context read.
  const [resolveAttempt, setResolveAttempt] = useState(0);

  // The registry's folder-to-context binding is authoritative; an unbound
  // folder settles to contextId=null without retrying.
  useEffect(() => {
    setResolvedFolder(null);
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
      .getFolderContext({ folder_id: FolderId(folderId) })
      .then((ctxId) => {
        if (!alive) return;
        setContextId(ctxId ?? null);
        setResolvedFolder(folderId);
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
  }, [registryClient, folderId, resolveAttempt]);

  const docsClient = useDocsClient(contextId, identity);

  const [list, setList] = useState<DocDto[]>([]);
  const [listLoading, setListLoading] = useState<boolean>(true);
  const [listError, setListError] = useState<Error | null>(null);
  // What `list` is a completed read of: a folder's client, or null for a
  // folder confirmed unbound. Anything else is a read still to come.
  const [listedFor, setListedFor] = useState<{
    folderId: string;
    client: DocsClient | null;
  } | null>(null);
  // The client's read in flight. A refetch asked for meanwhile joins it and
  // queues one more read, so its answer always postdates the ask.
  const readRef = useRef<{
    client: DocsClient;
    again: boolean;
    done: Promise<void>;
  } | null>(null);
  // The current client, so a read that lands after a folder switch is dropped.
  const clientRef = useRef<DocsClient | null>(null);
  clientRef.current = docsClient;
  // Last rendered list signature - lets refetch skip a no-op setList when
  // an SSE-driven refetch returns visually-identical data (diff-guard).
  const lastListSigRef = useRef<string>('');

  const refetch = useCallback(async () => {
    // The context read is still in flight; settling `list` now would be
    // reporting on the PREVIOUS folder's client, not this one's.
    if (contextResolving) return;
    if (!docsClient) {
      setList([]);
      lastListSigRef.current = '';
      setListLoading(false);
      if (folderId && resolvedFolder === folderId && !contextId) {
        setListedFor({ folderId, client: null });
      }
      return;
    }
    const pending = readRef.current;
    if (pending?.client === docsClient) {
      pending.again = true;
      return pending.done;
    }
    const stale = () => clientRef.current !== docsClient;
    const readList = async () => {
      setListError(null);
      try {
        const result = await listDocsJoining(
          docsClient,
          contextId,
          includeArchived,
          joinContextRef.current,
          healedContextsRef.current,
        );
        if (stale()) return;
        // Sort most-recent first so the list's default cursor lands
        // on what the user likely wants to read.
        result.sort((a, b) => b.updated_at - a.updated_at);
        // Diff-guard: only push new state when the rendered signature differs, so
        // the sidebar doesn't flicker on every SSE event. Deliberately EXCLUDES
        // updated_at - the list shows title + structure, not timestamps, so a
        // remote CONTENT edit (which only bumps updated_at) must NOT re-render
        // the other window's folder pane. Structural changes (create / delete /
        // rename / archive) still change the signature and refresh. Trade-off:
        // most-recent-first order re-sorts on the next structural change, not live
        // on content edits - the desired stable behaviour.
        const sig = result
          .map((d) => `${d.id}:${d.title}:${d.archived ? 1 : 0}`)
          .join('|');
        if (sig !== lastListSigRef.current) {
          lastListSigRef.current = sig;
          setList(result);
        }
        setListLoading(false);
        if (folderId) setListedFor({ folderId, client: docsClient });
      } catch (e: unknown) {
        if (stale()) return;
        // A failed read leaves `listedFor` as-is: a prior success for this
        // same client still stands; otherwise this stays unlisted.
        const err = e instanceof Error ? e : new Error(String(e));
        setListError(err);
        setListLoading(false);
      }
    };
    const read = { client: docsClient, again: false, done: Promise.resolve() };
    read.done = (async () => {
      do {
        read.again = false;
        await readList();
      } while (read.again && !stale());
    })().finally(() => {
      if (readRef.current === read) readRef.current = null;
    });
    readRef.current = read;
    return read.done;
  }, [
    docsClient,
    folderId,
    contextId,
    contextResolving,
    resolvedFolder,
    includeArchived,
  ]);


  // A failed context read has nothing to list against, so a retry re-reads it.
  const retry = useCallback(async () => {
    if (resolveError) setResolveAttempt((n) => n + 1);
    else await refetch();
  }, [resolveError, refetch]);

  useEffect(() => {
    setListLoading(true);
    void refetch();
  }, [refetch]);

  // Refresh on SSE events from the docs context - covers remote
  // creates/edits/deletes without polling. DEBOUNCED: the context emits
  // an event on every edit_doc, including the writer's OWN ~900ms
  // autosaves, so a 1:1 refetch makes the sidebar list re-fetch and
  // re-sort (by updated_at) on every keystroke-burst - visible as
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

  // Cross-instance refresh - when any other useDocs instance for the
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
    async (input: { title: string }): Promise<string> => {
      if (!docsClient) throw new Error('docs context not ready');
      const id = await docsClient.createDoc({ title: input.title });
      await refetch();
      notifyDocsRefetch(contextId);
      return id;
    },
    [docsClient, refetch, contextId],
  );

  const edit = useCallback(
    async (id: string, patch: { title: string }): Promise<void> => {
      if (!docsClient) throw new Error('docs context not ready');
      await docsClient.editDoc({ id, title: patch.title });
      notifyDocsRefetch(contextId);
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

  const addTag = useCallback(
    async (id: string, tag: string): Promise<void> => {
      if (!docsClient) throw new Error('docs context not ready');
      await docsClient.addTag({ id, tag });
      notifyDocsRefetch(contextId);
    },
    [docsClient, contextId],
  );

  const removeTag = useCallback(
    async (id: string, tag: string): Promise<void> => {
      if (!docsClient) throw new Error('docs context not ready');
      await docsClient.removeTag({ id, tag });
      notifyDocsRefetch(contextId);
    },
    [docsClient, contextId],
  );

  const archive = useCallback(
    async (id: string): Promise<void> => {
      if (!docsClient) throw new Error('docs context not ready');
      await docsClient.archiveDoc({ id });
      notifyDocsRefetch(contextId);
    },
    [docsClient, contextId],
  );

  const unarchive = useCallback(
    async (id: string): Promise<void> => {
      if (!docsClient) throw new Error('docs context not ready');
      await docsClient.unarchiveDoc({ id });
      notifyDocsRefetch(contextId);
    },
    [docsClient, contextId],
  );

  const listed =
    !!folderId &&
    resolvedFolder === folderId &&
    listedFor?.folderId === folderId &&
    listedFor.client === docsClient;

  return {
    contextId,
    contextResolving,
    list,
    loading: listLoading,
    listed,
    error: resolveError ?? listError,
    refetch: retry,
    create,
    edit,
    get,
    remove,
    addTag,
    removeTag,
    archive,
    unarchive,
    client: docsClient,
  };
}
