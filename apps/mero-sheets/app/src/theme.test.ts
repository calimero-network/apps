import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStoredTheme } from './theme';

// getStoredTheme reads localStorage; in the node test env we stub it.
function stubLocalStorage(value: string | null) {
  vi.stubGlobal('localStorage', {
    getItem: () => value,
    setItem: () => {},
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('getStoredTheme', () => {
  // Light first (the glass migration): an unset or unreadable preference
  // opens light; only a saved "dark" opens dark.
  it('defaults to light when nothing is stored', () => {
    stubLocalStorage(null);
    expect(getStoredTheme()).toBe('light');
  });

  it('defaults to light when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(getStoredTheme()).toBe('light');
  });

  it('honours a stored light preference', () => {
    stubLocalStorage('light');
    expect(getStoredTheme()).toBe('light');
  });

  it('honours a stored dark preference', () => {
    stubLocalStorage('dark');
    expect(getStoredTheme()).toBe('dark');
  });
});
