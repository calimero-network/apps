/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forgetLastLobby,
  lastLobbyKey,
  pickResumeLobby,
  readLastLobby,
  rememberLobby,
} from './lastLobby';

const NODE = 'http://node1.127.0.0.1.nip.io';
const OTHER = 'http://node2.127.0.0.1.nip.io';
const NS_A = 'aa'.repeat(32);
const NS_B = 'bb'.repeat(32);

describe('last opened lobby', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('is scoped to the node, ignoring a trailing slash', () => {
    expect(lastLobbyKey(`${NODE}/`)).toBe(lastLobbyKey(NODE));
    expect(lastLobbyKey(NODE)).not.toBe(lastLobbyKey(OTHER));
    expect(lastLobbyKey(null)).toBe(lastLobbyKey(''));
  });

  it('reads back what was remembered, on that node only', () => {
    rememberLobby(NODE, NS_A);
    expect(readLastLobby(NODE)).toBe(NS_A);
    expect(readLastLobby(OTHER)).toBeNull();
    rememberLobby(NODE, NS_B);
    expect(readLastLobby(NODE)).toBe(NS_B);
  });

  it('is forgotten on request', () => {
    rememberLobby(NODE, NS_A);
    forgetLastLobby(NODE);
    expect(readLastLobby(NODE)).toBeNull();
  });

  it('is not the picker preselection key', () => {
    localStorage.setItem('battleships:selectedNamespaceId', NS_A);
    expect(readLastLobby(NODE)).toBeNull();
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => rememberLobby(NODE, NS_A)).not.toThrow();
    expect(() => forgetLastLobby(NODE)).not.toThrow();
    expect(readLastLobby(NODE)).toBeNull();
  });
});

describe('pickResumeLobby', () => {
  it('resumes the remembered lobby while the node still lists it', () => {
    expect(pickResumeLobby([NS_A, NS_B], NS_B)).toBe(NS_B);
  });

  it('never guesses: nothing remembered, or no longer listed, is the picker', () => {
    expect(pickResumeLobby([NS_A, NS_B], null)).toBeNull();
    expect(pickResumeLobby([NS_A], NS_B)).toBeNull();
    expect(pickResumeLobby([], NS_A)).toBeNull();
  });
});
