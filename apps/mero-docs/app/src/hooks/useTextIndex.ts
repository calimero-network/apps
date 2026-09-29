// The text of every listed doc, read once per doc with `get_document` and kept
// in memory only, so search and Details can read inside documents on this device.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useMero,
  useSubscription,
  type SubscriptionEventData,
} from '@calimero-network/mero-react';
import type { DocsClient } from '@/generated/docs/DocsClient';
import { parseRichEvents } from '@/lib/rich/events';
import { docTextFromBlocks } from '@/lib/search/docText';
import { rowKey, type DocText } from '@/lib/workspaceIndex/types';
import { isContextEvent } from './useContextEvents';
import type { WorkspaceIndex } from './useWorkspaceIndex';

export const TEXT_INDEX_CONCURRENCY = 3; // doc reads in flight at once
const EVENT_REINDEX_MS = 1_000; // a writer's autosave dings every edit, so read once a burst settles
const PUBLISH_MS = 200; // results reach the palette at most this often while reads land

export type TextIndex = {
  texts: Map<string, DocText>;
  foldersDone: number;
  foldersTotal: number;
  pending: string[]; // folder ids not fully searched yet
  failed: string[]; // folder ids with a doc whose last read failed
};

type Job = {
  key: string;
  folderId: string;
  docId: string;
  contextId: string;
  client: DocsClient;
  updatedAt: number; // the list's version of the doc
};
type Snapshot = {
  texts: Map<string, DocText>;
  searched: Set<string>;
  failed: Set<string>;
};

const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve));

export function useTextIndex({
  rows,
  folders,
  folderStatus,
  contextOf,
  clientOf,
}: Pick<
  WorkspaceIndex,
  'rows' | 'folders' | 'folderStatus' | 'contextOf' | 'clientOf'
>): TextIndex {
  const { mero } = useMero();

  const wanted = useMemo(() => {
    const out = new Map<string, Job>();
    for (const r of rows) {
      const contextId = contextOf(r.folderId);
      const client = clientOf(r.folderId);
      if (!contextId || !client) continue;
      const key = rowKey(r.folderId, r.docId);
      out.set(key, {
        key,
        folderId: r.folderId,
        docId: r.docId,
        contextId,
        client,
        updatedAt: r.updatedAt,
      });
    }
    return out;
  }, [rows, contextOf, clientOf]);

  // One mutable engine per mount; the provider remounts per workspace, which cancels it.
  const engine = useRef({
    alive: true,
    wanted: new Map<string, Job>(),
    texts: new Map<string, DocText>(),
    readAt: new Map<string, number>(), // the list version each text was read at
    failed: new Set<string>(), // last read failed; its folder is not fully searched
    queue: [] as Job[],
    queued: new Set<string>(),
    running: new Map<string, { again: boolean }>(),
    timers: new Map<string, ReturnType<typeof setTimeout>>(),
    publishTimer: null as ReturnType<typeof setTimeout> | null,
  });
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    texts: new Map(),
    searched: new Set(),
    failed: new Set(),
  }));

  const publish = useCallback(() => {
    const e = engine.current;
    if (e.publishTimer) return;
    e.publishTimer = setTimeout(() => {
      e.publishTimer = null;
      if (e.alive)
        setSnapshot({
          texts: new Map(e.texts),
          searched: new Set(
            [...e.readAt.keys()].filter((key) => !e.failed.has(key)),
          ),
          failed: new Set(e.failed),
        });
    }, PUBLISH_MS);
  }, []);

  const pumpRef = useRef<() => void>(() => {});
  const run = useCallback(
    async (job: Job) => {
      const e = engine.current;
      // Still listed, in the same docs context it was queued for.
      const current = () =>
        e.alive && e.wanted.get(job.key)?.contextId === job.contextId;
      e.running.set(job.key, { again: false });
      let text: DocText | null = null;
      let failed = false;
      let version = job.updatedAt;
      try {
        await yieldToEventLoop();
        if (current()) {
          version = e.wanted.get(job.key)!.updatedAt;
          const blocks = await job.client.getDocument({
            doc: job.docId,
          });
          text = docTextFromBlocks(
            job.folderId,
            job.docId,
            blocks,
            window.location.origin,
          );
        }
      } catch (err: unknown) {
        failed = true;
        if (e.alive)
          console.warn('[useTextIndex] doc read failed', job.key, err);
      }
      const again = e.running.get(job.key)?.again;
      e.running.delete(job.key);
      if (!e.alive) return;
      const done = text !== null || failed;
      if (text && current()) {
        e.texts.set(job.key, text);
        e.readAt.set(job.key, version);
        e.failed.delete(job.key);
      } else if (failed && current()) {
        // The last good text, if any, stays searchable; the next list pass retries.
        e.failed.add(job.key);
      }
      const next = e.wanted.get(job.key);
      const behind = !!text && !!next && next.updatedAt > version;
      if (
        next &&
        (again || !done || !current() || behind) &&
        !e.queued.has(job.key)
      ) {
        e.queue.unshift(next);
        e.queued.add(job.key);
      }
      pumpRef.current();
      publish();
    },
    [publish],
  );

  const pump = useCallback(() => {
    const e = engine.current;
    if (!mero) return;
    while (e.alive && e.running.size < TEXT_INDEX_CONCURRENCY) {
      const job = e.queue.shift();
      if (!job) break;
      e.queued.delete(job.key);
      void run(job);
    }
  }, [mero, run]);
  pumpRef.current = pump;

  useEffect(() => {
    const e = engine.current;
    e.alive = true;
    return () => {
      e.alive = false;
      e.timers.forEach(clearTimeout);
      e.timers.clear();
      if (e.publishTimer) clearTimeout(e.publishTimer);
      e.publishTimer = null;
    };
  }, []);

  // A listed doc not read yet, or changed since its read (an edit missed while
  // the event stream was down), joins the queue; a doc gone from the list
  // leaves it; a failed read gets one more try on each pass.
  useEffect(() => {
    const e = engine.current;
    e.wanted = wanted;
    for (const key of [...e.texts.keys()])
      if (!wanted.has(key)) e.texts.delete(key);
    for (const key of [...e.readAt.keys()])
      if (!wanted.has(key)) e.readAt.delete(key);
    for (const key of [...e.failed]) if (!wanted.has(key)) e.failed.delete(key);
    e.queue = e.queue.flatMap((job) => wanted.get(job.key) ?? []);
    e.queued = new Set(e.queue.map((job) => job.key));
    for (const [key, job] of wanted) {
      const readAt = e.readAt.get(key);
      const fresh =
        readAt !== undefined && readAt >= job.updatedAt && !e.failed.has(key);
      if (fresh || e.queued.has(key) || e.running.has(key)) continue;
      e.queue.push(job);
      e.queued.add(key);
    }
    pump();
    publish();
  }, [wanted, pump, publish]);

  const reindex = useCallback(
    (key: string) => {
      const e = engine.current;
      const job = e.wanted.get(key);
      if (!job) return; // not listed yet: the next list read queues it
      const running = e.running.get(key);
      if (running) running.again = true;
      else if (!e.queued.has(key)) {
        e.queue.unshift(job);
        e.queued.add(key);
        pump();
      }
    },
    [pump],
  );

  const folderByContext = useMemo(() => {
    const out = new Map<string, string>();
    for (const f of folders) {
      const contextId = contextOf(f.id);
      if (contextId && folderStatus[f.id] === 'ready') out.set(contextId, f.id);
    }
    return out;
  }, [folders, folderStatus, contextOf]);

  const onEvent = useCallback(
    (event: SubscriptionEventData) => {
      if (!isContextEvent(event)) return;
      const folderId = folderByContext.get(event.contextId);
      if (!folderId) return;
      const { timers } = engine.current;
      for (const { kind, doc } of parseRichEvents(event.data)) {
        if (kind === 'TitleChanged') continue; // titles live in the list
        const key = rowKey(folderId, doc);
        clearTimeout(timers.get(key));
        timers.set(
          key,
          setTimeout(() => {
            timers.delete(key);
            reindex(key);
          }, EVENT_REINDEX_MS),
        );
      }
    },
    [folderByContext, reindex],
  );
  useSubscription([...folderByContext.keys()].sort(), onEvent);

  return useMemo(() => {
    const waiting = new Set<string>();
    const failedIn = new Set<string>();
    for (const [key, job] of wanted) {
      if (!snapshot.searched.has(key)) waiting.add(job.folderId);
      if (snapshot.failed.has(key)) failedIn.add(job.folderId);
    }
    // A syncing or failed folder is named by the palette instead of counted here.
    const searchable = folders.filter(
      (f) => folderStatus[f.id] === 'ready' || folderStatus[f.id] === 'loading',
    );
    const pending = searchable
      .filter((f) => folderStatus[f.id] !== 'ready' || waiting.has(f.id))
      .map((f) => f.id);
    return {
      texts: snapshot.texts,
      foldersDone: searchable.length - pending.length,
      foldersTotal: searchable.length,
      pending,
      failed: pending.filter((id) => failedIn.has(id)),
    };
  }, [snapshot, wanted, folders, folderStatus]);
}
