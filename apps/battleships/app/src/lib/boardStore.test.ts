import { describe, expect, it } from 'vitest';

import { cellsFromShips, computeCommitment, randomSalt } from './board';
import {
  boardKey,
  clearBoard,
  loadBoard,
  saltBytes,
  saltHex,
  saveBoard,
  type KeyValueStore,
} from './boardStore';

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

const FLEET = ['0,0;1,0', '0,2;1,2;2,2', '0,4;1,4;2,4', '0,6;1,6;2,6;3,6', '0,8;1,8;2,8;3,8;4,8'];

describe('boardStore', () => {
  it('keys a board by who placed it and which match it is for', () => {
    expect(boardKey('alice', 'm1')).not.toBe(boardKey('bob', 'm1'));
    expect(boardKey('alice', 'm1')).not.toBe(boardKey('alice', 'm2'));
  });

  it('round-trips the cells, the salt and the commitment', async () => {
    const store = memoryStore();
    const cells = cellsFromShips(FLEET);
    const salt = randomSalt();
    const commitment = await computeCommitment(cells, salt);

    expect(loadBoard('alice', 'm1', store)).toBeNull();
    expect(saveBoard('alice', 'm1', { cells, salt: saltHex(salt), commitment }, store)).toBe(true);

    const loaded = loadBoard('alice', 'm1', store);
    expect(loaded).not.toBeNull();
    expect(loaded!.cells).toEqual(cells);
    expect(loaded!.commitment).toBe(commitment);
    expect(saltBytes(loaded!)).toEqual(salt);
    // The board the device holds recomputes to the commitment it filed.
    await expect(computeCommitment(loaded!.cells, saltBytes(loaded!))).resolves.toBe(commitment);

    // Another player on the same device does not see it.
    expect(loadBoard('bob', 'm1', store)).toBeNull();

    clearBoard('alice', 'm1', store);
    expect(loadBoard('alice', 'm1', store)).toBeNull();
  });

  it('reads a damaged entry as no board rather than throwing', () => {
    const store = memoryStore();
    store.setItem(boardKey('alice', 'm1'), '{not json');
    expect(loadBoard('alice', 'm1', store)).toBeNull();
    store.setItem(boardKey('alice', 'm1'), JSON.stringify({ cells: 'nope', salt: 1 }));
    expect(loadBoard('alice', 'm1', store)).toBeNull();
  });

  it('survives a store that refuses writes', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(saveBoard('alice', 'm1', { cells: [], salt: '', commitment: '' }, broken)).toBe(false);
    expect(loadBoard('alice', 'm1', broken)).toBeNull();
    expect(() => clearBoard('alice', 'm1', broken)).not.toThrow();
    expect(loadBoard('alice', 'm1', null)).toBeNull();
  });
});
