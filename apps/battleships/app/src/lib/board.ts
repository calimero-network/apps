/**
 * The board, as the device keeps it.
 *
 * The contract never holds a board (`crates/game/src/lib.rs`, "Hidden
 * information"): it records a commitment at placement and the `(board, salt)`
 * reveal at match end, and the client does everything in between — answers
 * each incoming shot from the cells here, and draws "your waters" by laying
 * the opponent's answered shots over them. One code path for a node session
 * and an account on a relay, because neither has a private store the
 * contract could read.
 *
 * Cell values are the contract's `board::Cell` bytes, pinned here rather than
 * imported so that a renumbering upstream fails the commitment test instead of
 * silently committing to a board the reveal can never match.
 */

export const CELL_EMPTY = 0;
export const CELL_SHIP = 1;
export const CELL_HIT = 2;
export const CELL_MISS = 3;
export const CELL_PENDING = 4;

export const BOARD_SIZE = 10;
export const SALT_BYTES = 16;

/** The 100 pristine cells of a fleet, from the `"x,y;x,y"` ship groups the placement grid produces. */
export function cellsFromShips(ships: readonly string[], size = BOARD_SIZE): number[] {
  const cells = new Array<number>(size * size).fill(CELL_EMPTY);
  for (const ship of ships) {
    for (const cell of ship.split(';')) {
      const [xRaw, yRaw] = cell.split(',');
      const x = Number(xRaw);
      const y = Number(yRaw);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= size || y >= size) {
        throw new Error(`ship cell out of range: ${cell}`);
      }
      cells[y * size + x] = CELL_SHIP;
    }
  }
  return cells;
}

/**
 * `borsh(Vec<u8>)` of the cells: a 4-byte little-endian length, then the
 * bytes. This is what the contract hashes (`compute_commitment`) and what
 * `reveal_board` takes as `board_bytes`.
 */
export function encodeBoardBytes(cells: readonly number[]): Uint8Array {
  const out = new Uint8Array(4 + cells.length);
  new DataView(out.buffer).setUint32(0, cells.length, true);
  out.set(cells, 4);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) {
    throw new Error('not a hex string');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function randomSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  return salt;
}

/** `SHA256(borsh(cells) || salt)` as 64 hex characters: what `commit_board` records. */
export async function computeCommitment(
  cells: readonly number[],
  salt: Uint8Array,
): Promise<string> {
  if (salt.length !== SALT_BYTES) {
    throw new Error(`salt must be ${SALT_BYTES} bytes`);
  }
  const body = encodeBoardBytes(cells);
  const input = new Uint8Array(body.length + salt.length);
  input.set(body, 0);
  input.set(salt, body.length);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return bytesToHex(new Uint8Array(digest));
}

/** What the device answers to a shot at `(x, y)`: whether a ship is there. */
export function resolveShot(cells: readonly number[], x: number, y: number, size = BOARD_SIZE): boolean {
  if (x < 0 || y < 0 || x >= size || y >= size) return false;
  return cells[y * size + x] === CELL_SHIP;
}

/**
 * "Your waters": the pristine cells with the opponent's answered shots laid
 * over them — the replacement for the contract's old `get_own_board`.
 * `incoming` is `get_incoming_shots`: hit, miss or pending per cell, as the
 * contract derives it from the rows, so a cell shows what was ANSWERED, never
 * what the device would answer.
 */
export function overlayOwnBoard(cells: readonly number[], incoming: readonly number[]): number[] {
  return cells.map((cell, i) => {
    const shot = incoming[i];
    if (shot === CELL_HIT || shot === CELL_MISS || shot === CELL_PENDING) return shot;
    return cell;
  });
}
