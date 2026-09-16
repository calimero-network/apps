/**
 * @vitest-environment jsdom
 *
 * Scoped to this file, not the whole project: these helpers are the only ones
 * that touch `localStorage`, and the other five suites are pure and run fine —
 * and faster — in the default node environment.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMBEDDED_NAME_KEY,
  embeddedLobbyName,
  getStoredLobbyName,
  lobbyLabel,
  setStoredLobbyName,
} from './lobbyName';

const NS = 'ab'.repeat(32);

describe('stored lobby names', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a name', () => {
    setStoredLobbyName(NS, '  Friday game  ');
    expect(getStoredLobbyName(NS)).toBe('Friday game');
  });

  it('ignores a blank name rather than caching an empty label', () => {
    setStoredLobbyName(NS, '   ');
    expect(getStoredLobbyName(NS)).toBe('');
  });
});

describe('lobbyLabel', () => {
  beforeEach(() => localStorage.clear());

  it('prefers the server name', () => {
    setStoredLobbyName(NS, 'cached');
    expect(lobbyLabel(NS, 'from server')).toBe('from server');
  });

  it('falls back to the cached name — this is the joiner’s case', () => {
    // The joining node has no server-side name until the namespace metadata
    // syncs, and without the cache it renders a raw 64-hex id.
    setStoredLobbyName(NS, 'Friday game');
    expect(lobbyLabel(NS, undefined)).toBe('Friday game');
    expect(lobbyLabel(NS, '   ')).toBe('Friday game');
  });

  it('falls back to a short id when nothing is known', () => {
    expect(lobbyLabel(NS)).toBe(`Lobby ${NS.slice(0, 6)}`);
  });
});

describe('embeddedLobbyName', () => {
  it('reads the name riding beside the invitation', () => {
    expect(embeddedLobbyName({ [EMBEDDED_NAME_KEY]: ' Friday game ', invitation: {} }))
      .toBe('Friday game');
  });

  it('returns empty for a payload that carries none', () => {
    expect(embeddedLobbyName({ invitation: {} })).toBe('');
    expect(embeddedLobbyName(null)).toBe('');
    expect(embeddedLobbyName('nope')).toBe('');
  });
});
