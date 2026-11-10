import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_NAME_LEN,
  isUsableName,
  normaliseName,
  rememberName,
  rememberedName,
  selfNameStep,
  skipWorkspaceName,
} from './displayName';

/** A minimal in-memory Storage, and a switch to make it throw like Safari does. */
function stubStorage(throws = false) {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => {
      if (throws) throw new Error('blocked');
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (throws) throw new Error('blocked');
      map.set(k, v);
    },
  };
  vi.stubGlobal('window', { localStorage: store });
  return map;
}

afterEach(() => vi.unstubAllGlobals());

describe('normaliseName', () => {
  it('trims and collapses whitespace', () => {
    expect(normaliseName('  Ada   Lovelace  ')).toBe('Ada Lovelace');
    expect(normaliseName('\n\tAda\n')).toBe('Ada');
  });

  it('clamps to what the contract accepts, by CHARACTER not byte', () => {
    // The alternative is a round-trip that fails with "invalid input: label must
    // be at most 64 characters" — a message written for a developer.
    expect(normaliseName('a'.repeat(200))).toHaveLength(MAX_NAME_LEN);
    const emoji = '🙂'.repeat(100);
    expect(Array.from(normaliseName(emoji))).toHaveLength(MAX_NAME_LEN);
  });

  it('does not split a surrogate pair while clamping', () => {
    expect(normaliseName('🙂'.repeat(MAX_NAME_LEN + 5))).not.toContain('�');
  });
});

describe('isUsableName', () => {
  it('rejects blank, accepts anything the contract would', () => {
    expect(isUsableName('')).toBe(false);
    expect(isUsableName('   ')).toBe(false);
    expect(isUsableName('Ada')).toBe(true);
    expect(isUsableName('a'.repeat(200))).toBe(true); // clamped, so usable
  });
});

describe('rememberName / rememberedName', () => {
  it('round-trips a normalised name', () => {
    stubStorage();
    rememberName('  Ada  Lovelace ');
    expect(rememberedName()).toBe('Ada Lovelace');
  });

  it('never stores a blank name', () => {
    const map = stubStorage();
    rememberName('   ');
    expect(map.size).toBe(0);
    expect(rememberedName()).toBe('');
  });

  it('returns "" and does NOT throw when storage is blocked', () => {
    // Safari private mode and blocked site data throw on ACCESS, not on
    // reference. The suggestion is a convenience; it must never take the app
    // down with it.
    stubStorage(true);
    expect(() => rememberName('Ada')).not.toThrow();
    expect(rememberedName()).toBe('');
  });
});

describe('selfNameStep — your name, once per workspace', () => {
  const open = (over: Partial<Parameters<typeof selfNameStep>[0]> = {}) =>
    selfNameStep({ org: 'org-1', orgReady: true, orgName: '', rosterName: '', ...over });

  it('waits until the workspace names and the roster have loaded', () => {
    stubStorage();
    expect(open({ orgReady: false })).toEqual({ kind: 'wait' });
  });

  it("uses the workspace's name without asking, whatever this spreadsheet's roster says", () => {
    stubStorage();
    expect(open({ orgName: ' Ada ', rosterName: 'Old' })).toEqual({ kind: 'use', name: 'Ada' });
    expect(open({ orgName: 'Ada', orgReady: false })).toEqual({ kind: 'use', name: 'Ada' });
  });

  it('adopts a name the roster or this browser already had instead of asking', () => {
    const store = stubStorage();
    expect(open({ rosterName: 'Grace' })).toEqual({ kind: 'adopt', name: 'Grace' });
    store.set('mero-sheets:display-name', 'Linus');
    expect(open()).toEqual({ kind: 'adopt', name: 'Linus' });
  });

  it('asks when there is no name anywhere, and a skip holds for every spreadsheet in that workspace', () => {
    stubStorage();
    expect(open({ org: 'org-skip' })).toEqual({ kind: 'ask', suggestion: '' });
    skipWorkspaceName('org-skip');
    expect(open({ org: 'org-skip' })).toEqual({ kind: 'skipped' });
    expect(open({ org: 'org-other' })).toEqual({ kind: 'ask', suggestion: '' });
  });
});
