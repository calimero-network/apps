// Every doc this member can read, across every folder they can see, so Home
// and search never depend on which folders are expanded in the tree.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useJoinContext, useMero } from '@calimero-network/mero-react';
import { DocsClient, type DocDto } from '@/generated/docs/DocsClient';
import {
  nsToMs,
  type FolderInfo,
  type IndexRow,
} from '@/lib/workspaceIndex/types';
import { useContextEvents } from './useContextEvents';
import { listDocsJoining, subscribeDocsRefetch } from './useDocs';
import { useDriveWorkspace } from './useDriveWorkspace';

const EVENT_REFETCH_MS = 1_000; // a writer's autosave dings every edit, so read once a burst settles

export type FolderIndexStatus = 'loading' | 'ready' | 'syncing' | 'error';

export type WorkspaceIndex = {
  rows: IndexRow[];
  folders: FolderInfo[];
  foldersKnown: boolean; // every folder's access has resolved once for this workspace
  folderStatus: Record<string, FolderIndexStatus>;
  contextOf(folderId: string): string | undefined;
  refetchFolder(folderId: string): void;
};

type Binding = { contextId: string; client: DocsClient };
type Entry = {
  client: DocsClient;
  status: FolderIndexStatus;
  rows: IndexRow[];
};
type Read = { client: DocsClient; again: boolean };

export function toIndexRow(folderId: string, doc: DocDto): IndexRow {
  return {
    folderId,
    docId: doc.id,
    title: doc.title,
    tags: doc.tags,
    archived: doc.archived,
    createdAt: nsToMs(doc.created_at),
    updatedAt: nsToMs(doc.updated_at),
    createdBy: doc.created_by,
    updatedBy: doc.updated_by,
  };
}

export function useWorkspaceIndex(): WorkspaceIndex {
  const {
    folders: visible,
    registryFolders,
    resolvedFolderIds,
    selfIdentity,
  } = useDriveWorkspace();
  const { mero } = useMero();
  const { joinContext } = useJoinContext();
  const joinContextRef = useRef(joinContext);
  joinContextRef.current = joinContext;

  // Visible folders are already resolved and exclude restricted ones this
  // member is not in; the raw list is only trusted once this workspace's load has landed.
  const folders = useMemo<FolderInfo[]>(
    () =>
      registryFolders
        ? visible.map((f) => ({
            id: f.id,
            name: f.alias,
            parentId: f.parent_id ?? undefined,
            color: f.color ?? undefined,
          }))
        : [],
    [visible, registryFolders],
  );
  // A restricted folder is withheld until its access check lands, so the first
  // answer waits for them all; a folder that arrives later must not unknow the list.
  const allResolved =
    !!registryFolders &&
    registryFolders.every((f) => resolvedFolderIds.has(f.id));
  const [settledOnce, setSettledOnce] = useState(false);
  useEffect(() => {
    if (allResolved) setSettledOnce(true);
  }, [allResolved]);
  const foldersKnown = !!registryFolders && (allResolved || settledOnce);

  const contextById = useMemo(
    () =>
      new Map((registryFolders ?? []).map((f) => [f.id, f.context_id ?? null])),
    [registryFolders],
  );

  // One client per docs context for this session, so a re-render never looks
  // like a new binding and restarts a read.
  const clientCache = useRef({
    mero,
    selfIdentity,
    byContext: new Map<string, DocsClient>(),
  });
  const bindings = useMemo(() => {
    const out = new Map<string, Binding>();
    if (!mero || !selfIdentity) return out;
    const cache = clientCache.current;
    if (cache.mero !== mero || cache.selfIdentity !== selfIdentity) {
      clientCache.current = { mero, selfIdentity, byContext: new Map() };
    }
    const byContext = clientCache.current.byContext;
    for (const f of folders) {
      const contextId = contextById.get(f.id);
      if (!contextId) continue;
      let client = byContext.get(contextId);
      if (!client) {
        client = new DocsClient(mero, contextId);
        byContext.set(contextId, client);
      }
      out.set(f.id, { contextId, client });
    }
    return out;
  }, [mero, selfIdentity, folders, contextById]);
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const readsRef = useRef(new Map<string, Read>());
  const joinedRef = useRef(new Set<string>());

  const settle = useCallback(
    (folderId: string, client: DocsClient, next: Omit<Entry, 'client'>) =>
      setEntries((prev) => {
        const old = prev[folderId];
        const same =
          old?.client === client &&
          old.status === next.status &&
          JSON.stringify(old.rows) === JSON.stringify(next.rows);
        return same ? prev : { ...prev, [folderId]: { client, ...next } };
      }),
    [],
  );

  // A read asked for while one is in flight queues one more, so the answer
  // always postdates the ask; an answer for a replaced binding is dropped.
  const read = useCallback(
    (folderId: string) => {
      const binding = bindingsRef.current.get(folderId);
      if (!binding) return;
      const { client, contextId } = binding;
      const pending = readsRef.current.get(folderId);
      if (pending?.client === client) {
        pending.again = true;
        return;
      }
      const job: Read = { client, again: false };
      readsRef.current.set(folderId, job);
      const current = () =>
        bindingsRef.current.get(folderId)?.client === client;
      const join = (id: string) => {
        setEntries((prev) => ({
          ...prev,
          [folderId]: {
            client,
            status: 'syncing',
            rows: prev[folderId]?.rows ?? [],
          },
        }));
        return joinContextRef.current(id);
      };
      void (async () => {
        do {
          job.again = false;
          try {
            const docs = await listDocsJoining(
              client,
              contextId,
              true,
              join,
              joinedRef.current,
            );
            if (!current()) break;
            settle(folderId, client, {
              status: 'ready',
              rows: docs.map((d) => toIndexRow(folderId, d)),
            });
          } catch (e: unknown) {
            if (!current()) break;
            console.warn('[useWorkspaceIndex] folder read failed', folderId, e);
            // A failed re-read keeps the last good list rather than blanking it.
            setEntries((prev) => {
              const old = prev[folderId];
              if (old?.client === client && old.status === 'ready') return prev;
              return {
                ...prev,
                [folderId]: { client, status: 'error', rows: [] },
              };
            });
          }
        } while (job.again && current());
        if (readsRef.current.get(folderId) === job)
          readsRef.current.delete(folderId);
      })();
    },
    [settle],
  );

  const startedRef = useRef(new Map<string, DocsClient>());
  useEffect(() => {
    const started = startedRef.current;
    for (const id of [...started.keys()]) {
      if (!bindings.has(id)) started.delete(id);
    }
    for (const [folderId, { client }] of bindings) {
      if (started.get(folderId) === client) continue;
      started.set(folderId, client);
      read(folderId);
    }
  }, [bindings, read]);

  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach(clearTimeout);
  }, []);
  const onEvent = useCallback(
    (contextId?: string) => {
      for (const [folderId, binding] of bindingsRef.current) {
        if (contextId && binding.contextId !== contextId) continue;
        clearTimeout(timersRef.current.get(folderId));
        timersRef.current.set(
          folderId,
          setTimeout(() => {
            timersRef.current.delete(folderId);
            read(folderId);
          }, EVENT_REFETCH_MS),
        );
      }
    },
    [read],
  );
  const contextIds = useMemo(
    () => [...bindings.values()].map((b) => b.contextId),
    [bindings],
  );
  useContextEvents(contextIds, onEvent, { strict: true });

  // This app's own creates, renames and deletes refresh at once, not on the next event.
  useEffect(() => {
    const unsubscribes = [...bindings].map(([folderId, { contextId }]) =>
      subscribeDocsRefetch(contextId, () => read(folderId)),
    );
    return () => unsubscribes.forEach((off) => off());
  }, [bindings, read]);

  const refetchFolder = useCallback(
    (folderId: string) => {
      // An explicit retry may join again: the last join may have failed on a sync gap.
      const contextId = bindingsRef.current.get(folderId)?.contextId;
      if (contextId) joinedRef.current.delete(contextId);
      read(folderId);
    },
    [read],
  );

  const { rows, folderStatus } = useMemo(() => {
    const rows: IndexRow[] = [];
    const folderStatus: Record<string, FolderIndexStatus> = {};
    for (const f of folders) {
      const binding = bindings.get(f.id);
      const entry = entries[f.id];
      if (!contextById.get(f.id)) folderStatus[f.id] = 'syncing';
      else if (!binding || entry?.client !== binding.client)
        folderStatus[f.id] = 'loading';
      else folderStatus[f.id] = entry.status;
      if (folderStatus[f.id] === 'ready') rows.push(...entry.rows);
    }
    return { rows, folderStatus };
  }, [folders, bindings, entries, contextById]);

  const contextOf = useCallback(
    (folderId: string) => bindings.get(folderId)?.contextId,
    [bindings],
  );

  return useMemo(
    () => ({
      rows,
      folders,
      foldersKnown,
      folderStatus,
      contextOf,
      refetchFolder,
    }),
    [rows, folders, foldersKnown, folderStatus, contextOf, refetchFolder],
  );
}
