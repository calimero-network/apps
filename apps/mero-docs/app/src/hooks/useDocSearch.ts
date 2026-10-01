// A query asked of every ready folder's `search_docs` at once: the node's
// index answers for all of a folder's docs, whether or not this device has
// read them. A folder whose node cannot answer (search off, an app version
// without the view) is remembered for the session and left to the text this
// device reads (`useTextIndex`), as is one whose call failed this time. A
// folder is asked again once its docs change, here or synced from a peer.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceIndexValue } from '@/context/WorkspaceIndexContext';
import type { DocsClient } from '@/generated/docs/DocsClient';
import { normalizeQuery } from '@/lib/search/match';
import {
  folderMatches,
  isIndexUnavailable,
  searchFolder,
  type NodeHit,
} from '@/lib/search/nodeSearch';
import { rowKey } from '@/lib/workspaceIndex/types';

export const NODE_SEARCH_CONCURRENCY = 4; // folders asked at once
// How long after a folder's docs change it is asked again: the index takes up
// to a second to take in an edit.
export const INDEX_CATCH_UP_MS = 1_000;

export type DocSearch = {
  /** The query these hits answer; they are stale while it differs from the one asked. */
  query: string;
  hits: NodeHit[];
  /** Folders whose index answered `query`: their hits are complete. */
  served: Set<string>;
  /** Folders still being asked. */
  pending: number;
};

type Folder = { folderId: string; contextId: string; client: DocsClient };

const EMPTY: DocSearch = { query: '', hits: [], served: new Set(), pending: 0 };

/**
 * A mark of every folder's docs that moves when one is added, removed or
 * edited, and settles `INDEX_CATCH_UP_MS` later, once the index has it too.
 */
function useSettledVersion(): string {
  const { rows } = useWorkspaceIndexValue();
  const now = useMemo(() => {
    const byFolder = new Map<string, { docs: number; latest: number }>();
    for (const r of rows) {
      const v = byFolder.get(r.folderId) ?? { docs: 0, latest: 0 };
      v.docs++;
      v.latest = Math.max(v.latest, r.updatedAt);
      byFolder.set(r.folderId, v);
    }
    return [...byFolder]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, v]) => `${id}:${v.docs}:${v.latest}`)
      .join(',');
  }, [rows]);
  const [settled, setSettled] = useState(now);
  useEffect(() => {
    if (now === settled) return;
    const t = setTimeout(() => setSettled(now), INDEX_CATCH_UP_MS);
    return () => clearTimeout(t);
  }, [now, settled]);
  return settled;
}

/** The folders a search can ask: ready, with a client, not known to lack an index. */
function useSearchableFolders(): {
  folders: Folder[];
  /** Moves when the folders asked change. */
  key: string;
  /** Moves when what they hold does, once their indexes have it. */
  version: string;
  markUnavailable: (f: Folder) => void;
} {
  const { folders, folderStatus, contextOf, clientOf } =
    useWorkspaceIndexValue();
  const version = useSettledVersion();
  const [unavailable, setUnavailable] = useState<Set<string>>(() => new Set());
  const out: Folder[] = [];
  for (const f of folders) {
    const contextId = contextOf(f.id);
    const client = clientOf(f.id);
    if (folderStatus[f.id] !== 'ready' || !contextId || !client) continue;
    if (unavailable.has(contextId)) continue;
    out.push({ folderId: f.id, contextId, client });
  }
  const markUnavailable = useCallback(
    (f: Folder) =>
      setUnavailable((prev) =>
        prev.has(f.contextId) ? prev : new Set(prev).add(f.contextId),
      ),
    [],
  );
  const key = out.map((f) => `${f.folderId}:${f.contextId}`).join(',');
  return { folders: out, key, version, markUnavailable };
}

/** Runs `task` over `items`, at most `limit` at a time. */
async function eachConcurrent<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}

/** Asks `folder`; `null` when its index cannot answer, which is remembered. */
async function ask<T>(
  folder: Folder,
  markUnavailable: (f: Folder) => void,
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (err: unknown) {
    if (isIndexUnavailable(err)) markUnavailable(folder);
    else
      console.warn('[useDocSearch] search_docs failed', folder.folderId, err);
    return null;
  }
}

/** The palette's matches inside documents, per folder from its index. */
export function useDocSearch(query: string): DocSearch {
  const { folders, key, version, markUnavailable } = useSearchableFolders();
  const [result, setResult] = useState<DocSearch>(EMPTY);
  // A change of folder, client or content asks again, not every render's new array.
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const last = useRef({ query: '', key: '' });

  useEffect(() => {
    let cancelled = false;
    const asked = foldersRef.current;
    // Asked again after an edit: the hits shown stay until the new ones are in.
    const refresh = last.current.query === query && last.current.key === key;
    last.current = { query, key };
    if (!query || !asked.length) {
      setResult({ ...EMPTY, query });
      return;
    }
    const hits: NodeHit[] = [];
    const served = new Set<string>();
    let pending = asked.length;
    const publish = () => {
      if (!cancelled)
        setResult({ query, hits: [...hits], served: new Set(served), pending });
    };
    if (!refresh) publish();
    void eachConcurrent(asked, NODE_SEARCH_CONCURRENCY, async (folder) => {
      const found = await ask(folder, markUnavailable, () =>
        searchFolder(folder.folderId, folder.client, query),
      );
      pending--;
      if (found) {
        hits.push(...found);
        served.add(folder.folderId);
      }
      if (!refresh || pending === 0) publish();
    });
    return () => {
      cancelled = true;
    };
  }, [query, key, version, markUnavailable]);

  return result;
}

/**
 * The docs each asked text matches, per folder from its index, for the Home
 * filter: `answer(text)` is what has arrived so far (`undefined` before the
 * first folder answers) and asks the folders the first time it sees `text`.
 */
export function useDocMatches(): (
  text: string,
) => { keys: Set<string>; served: Set<string> } | undefined {
  const { folders, key, version, markUnavailable } = useSearchableFolders();
  const [answers, setAnswers] = useState<
    Map<string, { keys: Set<string>; served: Set<string> }>
  >(() => new Map());
  const asked = useRef(new Set<string>());
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const alive = useRef(true);

  // A folder joining or leaving asks every text again from nothing.
  useEffect(() => {
    asked.current = new Set();
    setAnswers(new Map());
  }, [key]);
  // An edit asks again too, keeping each answer until its fresh one is in.
  useEffect(() => {
    asked.current = new Set();
  }, [version]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fetchText = useCallback(
    (text: string, query: string, from: Folder[], refresh: boolean) => {
      const keys = new Set<string>();
      const served = new Set<string>();
      const publish = () =>
        setAnswers((prev) =>
          new Map(prev).set(text, {
            keys: new Set(keys),
            served: new Set(served),
          }),
        );
      // A first answer shows folder by folder; a refresh replaces the old
      // one whole, so a folder not yet asked again does not drop out.
      void eachConcurrent(from, NODE_SEARCH_CONCURRENCY, async (folder) => {
        const ids = await ask(folder, markUnavailable, () =>
          folderMatches(folder.client, query),
        );
        if (!ids || !alive.current) return;
        for (const id of ids) keys.add(rowKey(folder.folderId, id));
        served.add(folder.folderId);
        if (!refresh) publish();
      }).then(() => {
        if (refresh && alive.current) publish();
      });
    },
    [markUnavailable],
  );

  return useCallback(
    (text: string) => {
      const query = normalizeQuery(text).text;
      if (!query) return undefined;
      if (!asked.current.has(text) && foldersRef.current.length) {
        asked.current.add(text);
        // Asked from a render: the calls start after it.
        const from = foldersRef.current;
        const refresh = answers.has(text);
        setTimeout(() => fetchText(text, query, from, refresh));
      }
      return answers.get(text);
    },
    // `key` and `version` so a new folder set or an edit hands out a fresh matcher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answers, fetchText, key, version],
  );
}
