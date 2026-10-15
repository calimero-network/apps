import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node environment (no jsdom): an in-memory localStorage, installed before the
// modules under test read it at import.
class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}
(globalThis as { localStorage?: Storage }).localStorage = new FakeStorage();

const { ACCOUNT_KEYS, signOut } = await import('./signOut');
const { getActiveWorkspace, setActiveWorkspace } = await import(
  '../lib/activeWorkspace'
);
const { THEME_STORAGE_KEY } = await import('../theme');

beforeEach(() => {
  localStorage.clear();
  setActiveWorkspace(null);
});

describe('signOut', () => {
  it('ends the session and forgets what this account had open', () => {
    setActiveWorkspace('ns-1');
    for (const key of ACCOUNT_KEYS) localStorage.setItem(key, `${key}-value`);
    const logout = vi.fn();

    signOut(logout);

    expect(logout).toHaveBeenCalledTimes(1);
    expect(getActiveWorkspace()).toBeNull();
    expect(localStorage.getItem('mero-sign:workspace')).toBeNull();
    for (const key of ACCOUNT_KEYS) expect(localStorage.getItem(key)).toBeNull();
  });

  it('keeps the light/dark choice, which belongs to the browser', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    signOut(() => {});
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('forgets the selection before the session goes, so nothing re-enters it', () => {
    setActiveWorkspace('ns-1');
    localStorage.setItem('agreementContextID', 'ctx-1');
    let seen: [string | null, string | null] | null = null;
    signOut(() => {
      seen = [getActiveWorkspace(), localStorage.getItem('agreementContextID')];
    });
    expect(seen).toEqual([null, null]);
  });
});
