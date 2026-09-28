// The docs this device opened last in a workspace, newest first. Kept on this
// device only; the palette shows them before anything is typed.

import { useCallback, useState } from 'react';
import { rowKey, type IndexRow } from '@/lib/workspaceIndex/types';

const RECENT_KEY_PREFIX = 'mero-drive:recent:'; // + workspace id
const RECENT_MAX = 8; // entries kept per workspace

export type RecentDoc = { folderId: string; docId: string; openedAt: number };

function isRecentDoc(value: unknown): value is RecentDoc {
  const v = value as RecentDoc | null;
  return (
    !!v &&
    typeof v.folderId === 'string' &&
    typeof v.docId === 'string' &&
    typeof v.openedAt === 'number'
  );
}

function readRecent(key: string): RecentDoc[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter(isRecentDoc).slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

/** The stored list as it is now, for readers outside the layout that owns the hook. */
export function recentDocs(ws: string): RecentDoc[] {
  return ws ? readRecent(RECENT_KEY_PREFIX + ws) : [];
}

export function useRecentDocs(ws: string): {
  recent: RecentDoc[];
  touch(folderId: string, docId: string): void;
} {
  const key = RECENT_KEY_PREFIX + ws;
  const [stored, setStored] = useState(() => ({
    key,
    recent: readRecent(key),
  }));
  if (stored.key !== key) setStored({ key, recent: readRecent(key) });

  const touch = useCallback(
    (folderId: string, docId: string) => {
      if (!ws) return;
      const recent = [
        { folderId, docId, openedAt: Date.now() },
        ...readRecent(key).filter(
          (r) => r.folderId !== folderId || r.docId !== docId,
        ),
      ].slice(0, RECENT_MAX);
      try {
        localStorage.setItem(key, JSON.stringify(recent));
      } catch {
        // Storage full or blocked: the list still holds for this tab.
      }
      setStored({ key, recent });
    },
    [ws, key],
  );

  return { recent: stored.recent, touch };
}

/** Entries whose doc is still listed and not archived, each with its row. */
export function liveRecent(
  recent: RecentDoc[],
  rows: IndexRow[],
): { entry: RecentDoc; row: IndexRow }[] {
  const byKey = new Map(rows.map((r) => [rowKey(r.folderId, r.docId), r]));
  return recent.flatMap((entry) => {
    const row = byKey.get(rowKey(entry.folderId, entry.docId));
    return row && !row.archived ? [{ entry, row }] : [];
  });
}
