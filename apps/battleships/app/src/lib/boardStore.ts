/**
 * Where a board lives: on the device, keyed by who placed it and which
 * match it is for.
 *
 * Saved BEFORE the commitment is sent, so a request that fails after the
 * node recorded it does not leave a commitment with no board to answer from
 * or reveal. Nothing here is replicated or sent anywhere until the match is
 * over and `reveal_board` publishes it.
 *
 * `localStorage`, not IndexedDB: a board is 100 bytes plus a salt, it is read
 * synchronously on every render of the match page, and the store has to work
 * in the Playwright journey under a plain Chromium profile. Every access is
 * guarded — a private window, a blocked origin or a disabled store reads as
 * "no board", never as a crash.
 */

import { bytesToHex, hexToBytes } from './board';

export interface StoredBoard {
  /** The 100 pristine cells (water or ship). */
  cells: number[];
  /** 16 bytes, hex. */
  salt: string;
  /** `SHA256(borsh(cells) || salt)`, hex — what was committed. */
  commitment: string;
  savedAt: number;
}

/** The subset of `Storage` the store needs, so tests can hand in a map. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'battleships:board:v1';

/** `owner` is the player key the match names this player by (a context identity on a node, the account's device key on a relay). */
export function boardKey(owner: string, matchId: string): string {
  return `${PREFIX}:${owner}:${matchId}`;
}

function defaultStore(): KeyValueStore | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function isStoredBoard(value: unknown): value is StoredBoard {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.cells) &&
    v.cells.every((c) => typeof c === 'number') &&
    typeof v.salt === 'string' &&
    typeof v.commitment === 'string'
  );
}

export function loadBoard(
  owner: string,
  matchId: string,
  store: KeyValueStore | null = defaultStore(),
): StoredBoard | null {
  if (!store) return null;
  try {
    const raw = store.getItem(boardKey(owner, matchId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredBoard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveBoard(
  owner: string,
  matchId: string,
  board: Omit<StoredBoard, 'savedAt'>,
  store: KeyValueStore | null = defaultStore(),
): boolean {
  if (!store) return false;
  try {
    store.setItem(
      boardKey(owner, matchId),
      JSON.stringify({ ...board, savedAt: Date.now() } satisfies StoredBoard),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearBoard(
  owner: string,
  matchId: string,
  store: KeyValueStore | null = defaultStore(),
): void {
  if (!store) return;
  try {
    store.removeItem(boardKey(owner, matchId));
  } catch {
    // nothing to clear, or nowhere to clear it from
  }
}

/** The salt as bytes, for `reveal_board`. */
export function saltBytes(board: StoredBoard): Uint8Array {
  return hexToBytes(board.salt);
}

export function saltHex(salt: Uint8Array): string {
  return bytesToHex(salt);
}
