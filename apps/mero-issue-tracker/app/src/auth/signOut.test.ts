import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signOut } from './signOut';
import { readActiveNs, readActiveRepo, writeActiveNs, writeActiveRepo } from '../hooks/workspacePersistence';

// Node environment (no jsdom): an in-memory localStorage.
class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  key(index: number) { return Array.from(this.map.keys())[index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

beforeEach(() => {
  (globalThis as any).localStorage = new FakeStorage();
});

describe('signOut', () => {
  it('drops the session and the workspace selection, and keeps the theme', () => {
    writeActiveNs('ns-1');
    writeActiveRepo('ns-1', 'ctx-1');
    localStorage.setItem('issue-tracker:alias-set:ns-1:acc-1', '1');
    localStorage.setItem('mero-issue-tracker:theme', 'dark');
    const logout = vi.fn();

    signOut(logout);

    expect(logout).toHaveBeenCalledTimes(1);
    expect(readActiveNs()).toBeNull();
    expect(readActiveRepo('ns-1')).toBeNull();
    expect(localStorage.getItem('issue-tracker:alias-set:ns-1:acc-1')).toBeNull();
    expect(localStorage.getItem('mero-issue-tracker:theme')).toBe('dark');
  });

  it('forgets the selection before the session goes, so nothing re-enters it', () => {
    writeActiveNs('ns-1');
    let selectionAtLogout: string | null = 'unset';
    signOut(() => { selectionAtLogout = readActiveNs(); });
    expect(selectionAtLogout).toBeNull();
  });
});
