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

/**
 * Distinct authors from live cursors, self ordered first and marked.
 *
 * The local user is ALWAYS included, even when they have no live cursor: your
 * cursor is ephemeral (written on cell-select, removed on unmount), so relying
 * on it would drop you from the bar the moment you navigate away and back. You
 * are a collaborator in your own workspace regardless. Self is painted with the
 * signature `selfColor` (the green accent) rather than any cursor colour, so
 * "you" is instantly recognisable and stable across navigation.
 */
export function distinctCollaborators(
  cursors: Cursor[],
  selfKey: string | null,
  selfColor: string,
): Collaborator[] {
  const seen = new Map<string, Collaborator>();
  for (const c of cursors) {
    if (seen.has(c.author)) continue;
    const isSelf = c.author === selfKey;
    seen.set(c.author, {
      author: c.author,
      color: isSelf ? selfColor : c.color,
      label: avatarLabel(c.author),
      isSelf,
    });
  }
  // Guarantee the local user is present even without a live cursor.
  if (selfKey && !seen.has(selfKey)) {
    seen.set(selfKey, {
      author: selfKey,
      color: selfColor,
      label: avatarLabel(selfKey),
      isSelf: true,
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
