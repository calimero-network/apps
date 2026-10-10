import { describe, it, expect, beforeEach } from 'vitest';
import {
  readActiveNs,
  writeActiveNs,
  dropLegacyActiveNs,
  readActiveOrganisation,
  writeActiveOrganisation,
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
    localStorage.setItem('books:activeNs', 'old-namespace-id');
    expect(readActiveNs()).toBeNull();
  });

  it('returns an explicitly-written selection', () => {
    writeActiveNs('ns-1');
    expect(readActiveNs()).toBe('ns-1');
  });

  it('dropLegacyActiveNs removes the old key without ever reading it', () => {
    localStorage.setItem('books:activeNs', 'old-namespace-id');
    dropLegacyActiveNs();
    expect(localStorage.getItem('books:activeNs')).toBeNull();
    expect(readActiveNs()).toBeNull();
  });
});

describe('activeOrganisation persistence', () => {
  it('is namespace-scoped and round-trips an explicit selection', () => {
    writeActiveOrganisation('ns-1', 'organisation-a');
    expect(readActiveOrganisation('ns-1')).toBe('organisation-a');
    expect(readActiveOrganisation('ns-2')).toBeNull();
  });
});

describe('clearPersistedWorkspace', () => {
  it('drops the active namespace and every per-namespace organisation/alias key', () => {
    writeActiveNs('ns-1');
    writeActiveOrganisation('ns-1', 'organisation-a');
    localStorage.setItem('books:alias-set:ns-1', '1');
    clearPersistedWorkspace();
    expect(readActiveNs()).toBeNull();
    expect(readActiveOrganisation('ns-1')).toBeNull();
    expect(localStorage.getItem('books:alias-set:ns-1')).toBeNull();
  });
});
