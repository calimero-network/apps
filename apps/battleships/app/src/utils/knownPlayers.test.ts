/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  INVITER_KEY,
  addKnownPlayer,
  embeddedInviterKey,
  getKnownPlayers,
} from './knownPlayers';

const NS = 'ab'.repeat(32);
const KEY_A = '11'.repeat(32);
const KEY_B = '22'.repeat(32);

describe('known players', () => {
  beforeEach(() => localStorage.clear());

  it('remembers a key and de-duplicates', () => {
    addKnownPlayer(NS, KEY_A);
    addKnownPlayer(NS, KEY_A);
    addKnownPlayer(NS, KEY_B);
    expect(getKnownPlayers(NS)).toEqual([KEY_A, KEY_B]);
  });

  it('refuses anything that is not a 64-hex key', () => {
    addKnownPlayer(NS, 'nonsense');
    addKnownPlayer(NS, '11'.repeat(31));
    expect(getKnownPlayers(NS)).toEqual([]);
  });

  it('is scoped per namespace', () => {
    addKnownPlayer(NS, KEY_A);
    expect(getKnownPlayers('cd'.repeat(32))).toEqual([]);
  });

  it('survives corrupt storage rather than throwing', () => {
    localStorage.setItem(`bs-known-players-${NS}`, '{not json');
    expect(getKnownPlayers(NS)).toEqual([]);
  });
});

describe('embeddedInviterKey', () => {
  it('reads a valid key riding beside the invitation', () => {
    expect(embeddedInviterKey({ [INVITER_KEY]: ` ${KEY_A} `, invitation: {} })).toBe(KEY_A);
  });

  it('ignores a malformed one rather than offering an unusable opponent', () => {
    expect(embeddedInviterKey({ [INVITER_KEY]: 'nope' })).toBe('');
    expect(embeddedInviterKey({ invitation: {} })).toBe('');
    expect(embeddedInviterKey(null)).toBe('');
  });
});
