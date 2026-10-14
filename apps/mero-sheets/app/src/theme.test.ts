import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoredTheme, LEGACY_THEME_KEY, resetThemeForTests, setTheme, THEME_STORAGE_KEY } from './theme';

// getStoredTheme reads localStorage; in the node test env we stub it with a map.
function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

beforeEach(() => resetThemeForTests());
afterEach(() => vi.unstubAllGlobals());

describe('getStoredTheme', () => {
  // Light first (the glass migration): an unset or unreadable preference
  // opens light; only a saved "dark" opens dark.
  it('defaults to light when nothing is stored', () => {
    stubLocalStorage();
    expect(getStoredTheme()).toBe('light');
  });

  it('defaults to light when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(getStoredTheme()).toBe('light');
  });

  it('honours a stored light preference', () => {
    stubLocalStorage({ [THEME_STORAGE_KEY]: 'light' });
    expect(getStoredTheme()).toBe('light');
  });

  it('honours a stored dark preference', () => {
    stubLocalStorage({ [THEME_STORAGE_KEY]: 'dark' });
    expect(getStoredTheme()).toBe('dark');
  });

  // The app used the generic `app:theme` key before it had its own; a dark
  // choice made there survives the rename, and the old key goes.
  it('moves a choice saved under the old key to the new one', () => {
    const store = stubLocalStorage({ [LEGACY_THEME_KEY]: 'dark' });
    expect(getStoredTheme()).toBe('dark');
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(store.has(LEGACY_THEME_KEY)).toBe(false);
  });

  it('prefers the new key over a stale old one', () => {
    stubLocalStorage({ [THEME_STORAGE_KEY]: 'light', [LEGACY_THEME_KEY]: 'dark' });
    expect(getStoredTheme()).toBe('light');
  });
});

describe('setTheme', () => {
  it('remembers the choice under the app key', () => {
    const store = stubLocalStorage();
    setTheme('dark');
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark');
    setTheme('light');
    expect(store.get(THEME_STORAGE_KEY)).toBe('light');
  });
});
