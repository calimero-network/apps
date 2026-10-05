import { describe, expect, it } from 'vitest';

import {
  CELL_EMPTY,
  CELL_HIT,
  CELL_MISS,
  CELL_PENDING,
  CELL_SHIP,
  bytesToHex,
  cellsFromShips,
  computeCommitment,
  encodeBoardBytes,
  hexToBytes,
  overlayOwnBoard,
  randomSalt,
  resolveShot,
} from './board';

// The same fleet and salt as `commitment_vector_shared_with_the_client` in
// crates/game/src/lib.rs. If either side changes the framing, this is the
// test that says so.
const ALICE_FLEET = ['0,0;1,0', '0,2;1,2;2,2', '0,4;1,4;2,4', '0,6;1,6;2,6;3,6', '0,8;1,8;2,8;3,8;4,8'];
const ALICE_SALT = new Uint8Array(16).fill(0xa5);
const ALICE_COMMITMENT = '37188894d025229c47a83365463dbc5e15d7a267aa13ef63f4d963b0d03def4f';

describe('cellsFromShips', () => {
  it('lays the fleet out row-major, ship cells only', () => {
    const cells = cellsFromShips(ALICE_FLEET);
    expect(cells).toHaveLength(100);
    expect(cells.filter((c) => c === CELL_SHIP)).toHaveLength(17);
    expect(cells[0]).toBe(CELL_SHIP); // (0,0)
    expect(cells[1]).toBe(CELL_SHIP); // (1,0)
    expect(cells[2]).toBe(CELL_EMPTY);
    expect(cells[8 * 10 + 4]).toBe(CELL_SHIP); // (4,8)
  });

  it('refuses a cell off the board', () => {
    expect(() => cellsFromShips(['9,9;10,9'])).toThrow(/out of range/);
  });
});

describe('encodeBoardBytes', () => {
  it('is borsh of Vec<u8>: a little-endian u32 length, then the cells', () => {
    const bytes = encodeBoardBytes([1, 0, 0, 1]);
    expect(Array.from(bytes)).toEqual([4, 0, 0, 0, 1, 0, 0, 1]);
  });
});

describe('computeCommitment', () => {
  it('matches the contract vector for the same board and salt', async () => {
    await expect(computeCommitment(cellsFromShips(ALICE_FLEET), ALICE_SALT)).resolves.toBe(
      ALICE_COMMITMENT,
    );
  });

  it('changes with the salt', async () => {
    const other = new Uint8Array(16).fill(0xa6);
    await expect(computeCommitment(cellsFromShips(ALICE_FLEET), other)).resolves.not.toBe(
      ALICE_COMMITMENT,
    );
  });

  it('refuses a salt that is not 16 bytes', async () => {
    await expect(computeCommitment([0], new Uint8Array(15))).rejects.toThrow(/16 bytes/);
  });
});

describe('hex', () => {
  it('round-trips', () => {
    const salt = randomSalt();
    expect(salt).toHaveLength(16);
    expect(hexToBytes(bytesToHex(salt))).toEqual(salt);
    expect(bytesToHex(new Uint8Array([0, 171, 255]))).toBe('00abff');
  });

  it('rejects non-hex', () => {
    expect(() => hexToBytes('zz')).toThrow();
    expect(() => hexToBytes('abc')).toThrow();
  });
});

describe('resolveShot', () => {
  const cells = cellsFromShips(ALICE_FLEET);

  it('answers hit on a ship cell and miss on water', () => {
    expect(resolveShot(cells, 0, 0)).toBe(true);
    expect(resolveShot(cells, 4, 8)).toBe(true);
    expect(resolveShot(cells, 9, 9)).toBe(false);
    expect(resolveShot(cells, 2, 0)).toBe(false);
  });

  it('never answers hit off the board', () => {
    expect(resolveShot(cells, 10, 0)).toBe(false);
    expect(resolveShot(cells, -1, 0)).toBe(false);
  });
});

describe('overlayOwnBoard', () => {
  it('shows the answered shots over the pristine board and nothing else', () => {
    const cells = cellsFromShips(ALICE_FLEET);
    const incoming = new Array<number>(100).fill(0);
    incoming[0] = CELL_HIT; // (0,0) answered hit
    incoming[5] = CELL_MISS; // (5,0) answered miss
    incoming[1] = CELL_PENDING; // (1,0) waiting for an answer
    const own = overlayOwnBoard(cells, incoming);
    expect(own[0]).toBe(CELL_HIT);
    expect(own[5]).toBe(CELL_MISS);
    expect(own[1]).toBe(CELL_PENDING);
    // Untouched ship cells stay ships; untouched water stays water.
    expect(own[8 * 10 + 4]).toBe(CELL_SHIP);
    expect(own[99]).toBe(CELL_EMPTY);
  });
});
