// ── Theme (light / dark) ────────────────────────────────────────────────────
//
// The whole app themes off a `data-theme` attribute on <html> and the CSS
// variables in index.css. We persist the user's choice per-install and default
// to their OS preference on first run. `initTheme()` runs before React mounts so
// there's no flash of the wrong theme.

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "mm-theme";

function systemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

let current: Theme = "dark";
const listeners = new Set<() => void>();

function apply(theme: Theme): void {
  current = theme;
  document.documentElement.setAttribute("data-theme", theme);
  listeners.forEach((l) => l());
}

/** Resolve + apply the initial theme. Call once, before React renders. */
export function initTheme(): void {
  apply(stored() ?? systemTheme());
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
