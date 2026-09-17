// ── Theme (light / dark) ────────────────────────────────────────────────────
//
// The whole app themes off a `data-theme` attribute on <html> and the CSS
// variables in index.css. We persist the user's choice per-install and default
// to their OS preference on first run. `initTheme()` runs before React mounts so
// there's no flash of the wrong theme.

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "mm-theme";

/**
 * The theme a first-time visitor gets.
 *
 * Light, not the OS preference. The app now wears the Calimero palette that
 * mero-stream and this app's own landing page wear, and that palette is a light
 * one — someone whose OS is dark used to meet the marketing page in Calimero
 * green and the app in something else one click later.
 *
 * This is only the STARTING point: the toggle and the persisted choice are
 * untouched, so a dark-preferring user is one click from dark and stays there.
 */
const FIRST_RUN_THEME: Theme = "light";

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

let current: Theme = FIRST_RUN_THEME;
const listeners = new Set<() => void>();

function apply(theme: Theme): void {
  current = theme;
  document.documentElement.setAttribute("data-theme", theme);
  listeners.forEach((l) => l());
}

/** Resolve + apply the initial theme. Call once, before React renders. */
export function initTheme(): void {
  apply(stored() ?? FIRST_RUN_THEME);
}

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore blocked storage */
  }
  apply(theme);
}

export function toggleTheme(): void {
  setTheme(current === "dark" ? "light" : "dark");
}

/** Subscribe a component to the current theme (re-renders on change). */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getTheme,
    getTheme,
  );
  const toggle = useCallback(() => toggleTheme(), []);
  return { theme, toggle };
}
