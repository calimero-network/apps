// A query asked of every ready folder's `search_docs` at once: the node's
// index answers for all of a folder's docs, whether or not this device has
// read them. A folder whose node cannot answer (search off, an app version
// without the view) is remembered for the session and left to the text this
// device reads (`useTextIndex`), as is one whose call failed this time.

import { useCallback, useEffect, useRef, useState } from 'react';
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

/** The folders a search can ask: ready, with a client, not known to lack an index. */
function useSearchableFolders(): {
  folders: Folder[];
  markUnavailable: (f: Folder) => void;
} {
  const { folders, folderStatus, contextOf, clientOf } =
    useWorkspaceIndexValue();
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
  return { folders: out, markUnavailable };
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
  const { folders, markUnavailable } = useSearchableFolders();
  const [result, setResult] = useState<DocSearch>(EMPTY);
  // Only a change of folder or client asks again, not every render's new array.
  const key = folders.map((f) => `${f.folderId}:${f.contextId}`).join(',');
  const foldersRef = useRef(folders);
  foldersRef.current = folders;

  useEffect(() => {
    let cancelled = false;
    const asked = foldersRef.current;
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
    publish();
    void eachConcurrent(asked, NODE_SEARCH_CONCURRENCY, async (folder) => {
      const found = await ask(folder, markUnavailable, () =>
        searchFolder(folder.folderId, folder.client, query),
      );
      pending--;
      if (found) {
        hits.push(...found);
        served.add(folder.folderId);
      }
      publish();
    });
    return () => {
      cancelled = true;
    };
  }, [query, key, markUnavailable]);

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
  const { folders, markUnavailable } = useSearchableFolders();
  const [answers, setAnswers] = useState<
    Map<string, { keys: Set<string>; served: Set<string> }>
  >(() => new Map());
  const asked = useRef(new Set<string>());
  const key = folders.map((f) => `${f.folderId}:${f.contextId}`).join(',');
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const alive = useRef(true);

  // A folder joining or leaving asks every text again.
  useEffect(() => {
    asked.current = new Set();
    setAnswers(new Map());
  }, [key]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fetchText = useCallback(
    (text: string, query: string, from: Folder[]) => {
      const keys = new Set<string>();
      const served = new Set<string>();
      void eachConcurrent(from, NODE_SEARCH_CONCURRENCY, async (folder) => {
        const ids = await ask(folder, markUnavailable, () =>
          folderMatches(folder.client, query),
        );
        if (!ids || !alive.current) return;
        for (const id of ids) keys.add(rowKey(folder.folderId, id));
        served.add(folder.folderId);
        setAnswers((prev) =>
          new Map(prev).set(text, {
            keys: new Set(keys),
            served: new Set(served),
          }),
        );
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
        setTimeout(() => fetchText(text, query, from));
      }
      return answers.get(text);
    },
    // `key` so a new folder set hands out a fresh matcher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answers, fetchText, key],
  );
}
