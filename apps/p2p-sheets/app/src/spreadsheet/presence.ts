import type { Cursor } from '../api/spreadsheet/SpreadsheetClient';

/** 1–2 char uppercase avatar label from an opaque author key. */
export function avatarLabel(author: string): string {
  return author.slice(0, 2).toUpperCase() || '?';
}

export interface Collaborator {
  author: string;
  color: string;
  label: string;
  isSelf: boolean;
}

/** Distinct authors from live cursors, self ordered first and marked. */
export function distinctCollaborators(
  cursors: Cursor[],
  selfKey: string | null,
): Collaborator[] {
  const seen = new Map<string, Collaborator>();
  for (const c of cursors) {
    if (seen.has(c.author)) continue;
    seen.set(c.author, {
      author: c.author,
      color: c.color,
      label: avatarLabel(c.author),
      isSelf: c.author === selfKey,
    });
  }
  return [...seen.values()].sort(
    (a, b) => Number(b.isSelf) - Number(a.isSelf),
  );
}

/** Count of distinct authors excluding the local user. */
export function peerCount(cursors: Cursor[], selfKey: string | null): number {
  const authors = new Set<string>();
  for (const c of cursors) if (c.author !== selfKey) authors.add(c.author);
  return authors.size;
}

export function syncLabel(synced: boolean): string {
  return synced ? 'Synced' : 'Syncing…';
}

export function peersLabel(peers: number): string {
  return `${peers} ${peers === 1 ? 'peer' : 'peers'}`;
}

export function cellsLabel(cells: number): string {
  return `${cells} ${cells === 1 ? 'cell' : 'cells'}`;
}
