import { describe, it, expect, beforeEach } from 'vitest';
import {
  readActiveNs,
  writeActiveNs,
  dropLegacyActiveNs,
  readActiveRepo,
  writeActiveRepo,
  clearPersistedWorkspace,
} from './workspacePersistence';

// Minimal in-memory localStorage: this project's vitest config runs in the
// node environment (no jsdom), so there's no global localStorage by default.
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

describe('readActiveNs', () => {
  it('ignores a legacy unversioned key: an old build never auto-enters', () => {
    localStorage.setItem('issue-tracker:activeNs', 'old-namespace-id');
    expect(readActiveNs()).toBeNull();
  });

  it('returns an explicitly-written selection', () => {
    writeActiveNs('ns-1');
    expect(readActiveNs()).toBe('ns-1');
  });

  it('dropLegacyActiveNs removes the old key without ever reading it', () => {
    localStorage.setItem('issue-tracker:activeNs', 'old-namespace-id');
    dropLegacyActiveNs();
    expect(localStorage.getItem('issue-tracker:activeNs')).toBeNull();
    expect(readActiveNs()).toBeNull();
  });
});

describe('activeRepo persistence', () => {
  it('is namespace-scoped and round-trips an explicit selection', () => {
    writeActiveRepo('ns-1', 'repo-a');
    expect(readActiveRepo('ns-1')).toBe('repo-a');
    expect(readActiveRepo('ns-2')).toBeNull();
  });
});

describe('clearPersistedWorkspace', () => {
  it('drops the active namespace and every per-namespace repo/alias key', () => {
    writeActiveNs('ns-1');
    writeActiveRepo('ns-1', 'repo-a');
    localStorage.setItem('issue-tracker:alias-set:ns-1', '1');
    clearPersistedWorkspace();
    expect(readActiveNs()).toBeNull();
    expect(readActiveRepo('ns-1')).toBeNull();
    expect(localStorage.getItem('issue-tracker:alias-set:ns-1')).toBeNull();
  });
});
