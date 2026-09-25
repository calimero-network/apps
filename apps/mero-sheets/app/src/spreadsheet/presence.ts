import { initials, shortId, type PersonLabel } from '../lib/people';
import type { Rect } from './refs';

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

// ── Live cursors over ephemeral presence ────────────────────────────────────
//
// Where each person's cursor is used to be CRDT state: every click wrote a
// cursor record through the contract, a replicated, persisted commit that every
// peer then re-fetched. A cursor is presence, not data, so it now travels on
// the node's ephemeral channel: nothing is stored or synced into the
// workbook's history, and a peer's cursor arrives without a round trip.

/**
 * What each peer publishes. Short keys because the node re-sends the slice on
 * every heartbeat.
 */
export interface PresenceSlice {
  /**
   * The publisher's member id (`whoami`), so the roster can name them. The
   * node stamps each slice with the per-context identity, which the roster
   * does not know. Self-asserted: presence is advisory, nothing is authorised
   * on it.
   */
  d?: string;
  /** Sheet id. */
  s?: string;
  r?: number;
  c?: number;
  /** The selected range as [top, left, bottom, right], when it spans cells. */
  g?: [number, number, number, number] | null;
  /** Bumped on every beat, so a live tab's slice keeps changing. */
  n?: number;
}

/**
 * A peer's cursor, and the range they have selected, if any. Positions, not
 * ids: presence is advisory and short-lived, and a peer who inserts a row
 * republishes where they are.
 */
export interface PeerCursor {
  /** The presence author (per-context identity) the slice came from. */
  id: string;
  /** The member id the slice names: the roster key. */
  author: string;
  sheet_id: string;
  row: number;
  col: number;
  color: string;
  updated_at: number;
  range: Rect | null;
}

/** How often an open spreadsheet re-publishes its slice. */
export const PRESENCE_BEAT_MS = 10_000;

/**
 * A slice that has not CHANGED for this long is dropped. The node keeps
 * re-sending a closed tab's last slice for as long as the node itself is up,
 * so arrival says nothing; a live tab changes `n` every beat.
 */
export const PRESENCE_STALE_MS = 25_000;

const PALETTE = [
  '#E74C3C', '#3498DB', '#2ECC71', '#F39C12', '#9B59B6', '#1ABC9C', '#E67E22', '#34495E',
  '#E91E63', '#00BCD4', '#FF5722', '#8BC34A', '#607D8B', '#FF9800', '#673AB7',
];

/** A stable colour per member id: the same mapping the contract used. */
export function presenceColor(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return PALETTE[sum % PALETTE.length];
}

const isIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/**
 * Live peer cursors from the presence map: malformed slices, your own echo,
 * and slices unchanged for `PRESENCE_STALE_MS` are dropped, and a member with
 * several tabs open shows the one that moved last.
 */
export function cursorsFromPresence(
  peers: ReadonlyMap<string, PresenceSlice>,
  changedAt: ReadonlyMap<string, number>,
  now: number,
  selfId: string | null,
): PeerCursor[] {
  const byMember = new Map<string, { at: number; cursor: PeerCursor }>();
  for (const [author, slice] of peers) {
    const { d, s, r, c, g } = slice ?? {};
    if (typeof d !== 'string' || !d || d === selfId) continue;
    if (typeof s !== 'string' || !isIndex(r) || !isIndex(c)) continue;
    const at = changedAt.get(author) ?? now;
    if (now - at > PRESENCE_STALE_MS) continue;
    const prev = byMember.get(d);
    if (prev && prev.at >= at) continue;
    const range = Array.isArray(g) && g.length === 4 && g.every(isIndex)
      ? { top: g[0], left: g[1], bottom: g[2], right: g[3] }
      : null;
    byMember.set(d, {
      at,
      cursor: { id: author, author: d, sheet_id: s, row: r, col: c, color: presenceColor(d), updated_at: at, range },
    });
  }
  return [...byMember.values()].map((v) => v.cursor);
}

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
 * The local user is ALWAYS included, even with no live cursor: your own echo
 * is not in the peer list, and relying on it would drop you from the bar. You are a
 * collaborator in your own spreadsheet regardless. Self is painted with the
 * signature `selfColor` rather than any cursor colour, so "you" is instantly
 * recognisable and stable across navigation.
 *
 * `selfKey` must be the member id (`whoami`) that cursors carry, not the
 * context's executor public key. Both are 64 hex, so passing the wrong one
 * compiles, never matches, and quietly renders the local user as a stranger.
 */
export function distinctCollaborators(
  cursors: readonly PeerCursor[],
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
  cursors: readonly PeerCursor[],
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
