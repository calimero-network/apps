import type { Cursor } from '../api/spreadsheet/SpreadsheetClient';
import { initials, shortId, type PersonLabel } from '../lib/people';

/**
 * Who is in the spreadsheet, and what to call them.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * Every collaborator was a 64-hex device key. The avatar was `author.slice(0,2)`
 * — so two people whose keys begin "3a" got the same badge and neither badge
 * meant anything — and the tooltip was the whole key. The contract now stores
 * the name each person chose when they joined, so there is something real to
 * show; this is the mapping.
 *
 * The roster (`labels`) and the live cursors are different sources answering
 * different questions — "who is in here" vs "who has their cursor somewhere
 * right now" — and they are joined, not conflated: a member with no cursor is
 * still a collaborator, and a cursor whose author has not named themselves yet
 * still needs a tile.
 */

/** 1–2 char uppercase avatar label. */
export function avatarLabel(name: string): string {
  return initials(name);
}

export interface Collaborator {
  author: string;
  color: string;
  /** What to print: the chosen name, or a short id when there is none. */
  name: string;
  /** Two-character badge derived from `name`. */
  label: string;
  /** True when `name` is a truncated id rather than something anyone chose. */
  anonymous: boolean;
  isSelf: boolean;
}

/**
 * Distinct collaborators, self ordered first and marked.
 *
 * The local user is ALWAYS included, even with no live cursor: your cursor is
 * ephemeral (written on cell-select, removed on unmount), so relying on it would
 * drop you from the bar the moment you navigate away and back. You are a
 * collaborator in your own spreadsheet regardless. Self is painted with the
 * signature `selfColor` rather than any cursor colour, so "you" is instantly
 * recognisable and stable across navigation.
 *
 * `selfKey` must be the id the CONTRACT writes under (`whoami`), not the
 * context's executor public key. Both are 64 hex, so passing the wrong one
 * compiles, never matches, and quietly renders the local user as a stranger.
 */
export function distinctCollaborators(
  cursors: readonly Cursor[],
  selfKey: string | null,
  selfColor: string,
  labels: ReadonlyMap<string, PersonLabel> = new Map(),
): Collaborator[] {
  const named = (author: string): Pick<Collaborator, 'name' | 'anonymous'> => {
    const label = labels.get(author);
    return label
      ? { name: label.label, anonymous: label.anonymous }
      : { name: shortId(author), anonymous: true };
  };

  const seen = new Map<string, Collaborator>();

  // Everyone on the contract roster is here whether or not they have a cursor.
  for (const [author, label] of labels) {
    const isSelf = author === selfKey;
    seen.set(author, {
      author,
      color: isSelf ? selfColor : '',
      name: label.label,
      label: avatarLabel(label.label),
      anonymous: label.anonymous,
      isSelf,
    });
  }

  // Cursors carry the colour, and can name someone the roster has not caught up
  // with yet — a peer's `join` and their first cell-select land in either order.
  for (const c of cursors) {
    const isSelf = c.author === selfKey;
    const existing = seen.get(c.author);
    if (existing) {
      if (!existing.isSelf) existing.color = c.color;
      continue;
    }
    const n = named(c.author);
    seen.set(c.author, {
      author: c.author,
      color: isSelf ? selfColor : c.color,
      name: n.name,
      label: avatarLabel(n.name),
      anonymous: n.anonymous,
      isSelf,
    });
  }

  // Guarantee the local user is present even with no cursor and no roster row —
  // which is exactly the window between opening a spreadsheet and naming
  // yourself in it.
  if (selfKey && !seen.has(selfKey)) {
    const n = named(selfKey);
    seen.set(selfKey, {
      author: selfKey,
      color: selfColor,
      name: n.name,
      label: avatarLabel(n.name),
      anonymous: n.anonymous,
      isSelf: true,
    });
  }

  // Self first, then named people, then placeholders; ties broken on the id so
  // the bar does not reshuffle on every sync event.
  return [...seen.values()]
    .map((c) => ({ ...c, color: c.color || '#8a8f8a' }))
    .sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      if (a.anonymous !== b.anonymous) return a.anonymous ? 1 : -1;
      return a.name.localeCompare(b.name) || a.author.localeCompare(b.author);
    });
}

/** Count of distinct authors with a live cursor, excluding the local user. */
export function peerCount(
  cursors: readonly Cursor[],
  selfKey: string | null,
): number {
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
