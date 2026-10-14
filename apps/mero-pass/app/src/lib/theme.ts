// ── Light / dark, the way the rest of Calimero does it ──────────────────────
//
// The fleet's glass rules:
//
//   * light is the default, and `prefers-color-scheme` is NOT consulted — every
//     app opens light, and dark (smoked glass) is a choice someone makes;
//   * the choice is `data-theme` on `<html>`, which `src/index.css` keys off;
//   * it is saved only when the toggle is pressed, never on mount, so a
//     visit that changed nothing records nothing;
//   * it is applied before React renders (`index.html` does it inline, before
//     first paint), so the page never flashes the wrong theme.

import { useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark';

export const THEME_KEY = 'mero-pass:theme';
export const DEFAULT_THEME: ThemeMode = 'light';

/** What the toggle last saved, or the default. */
export function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** The mode the page is showing right now. */
export function currentTheme(): ThemeMode {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

const listeners = new Set<() => void>();

/** Show `mode`, and tell the browser chrome to match. */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = mode;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', mode === 'light' ? '#f6f7fb' : '#0b0e18');
  for (const fn of listeners) fn();
}

/**
 * The mode on screen, reactively. The top-bar toggle and Security →
 * Appearance both change it, and each has to show what the other did.
 */
export function useTheme(): ThemeMode {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    currentTheme,
    () => DEFAULT_THEME,
  );
}

/** Save and show `mode`. Only the toggle calls this. */
export function chooseTheme(mode: ThemeMode): void {
  applyTheme(mode);
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // Private window: the choice lasts for this tab only.
  }
}
