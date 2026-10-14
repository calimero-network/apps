import { useSyncExternalStore } from "react";

/**
 * The app's light/dark switch.
 *
 * Light is the default for everyone; dark is only ever an explicit choice, kept
 * in localStorage under `THEME_KEY`. The choice is applied as `data-theme="dark"`
 * on `<html>`, which is the marker @calimero-apps/glass switches its tokens on.
 *
 * index.html applies the stored choice with an inline script before the first
 * paint, so a dark user never sees a light flash. Keep the key and the attribute
 * there in step with this file.
 */
export type Theme = "light" | "dark";

export const THEME_KEY = "mero-design:theme";

export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    // A private window or blocked storage is not a reason to fail.
    return "light";
  }
}

/** Reflects a theme onto `<html>`. Light removes the marker rather than setting it. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
}

const listeners = new Set<() => void>();
let current: Theme | null = null;

function snapshot(): Theme {
  if (current === null) current = readStoredTheme();
  return current;
}

export function setTheme(theme: Theme): void {
  current = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* the choice still holds for this session */
  }
  applyTheme(theme);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab switching keeps this one in step.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY) return;
    current = readStoredTheme();
    applyTheme(current);
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The current theme, and a toggle. Every caller re-renders on a switch. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "light" as Theme);
  return { theme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}

/** Test-only: forget the cached choice so the next read goes to storage. */
export function resetThemeForTests(): void {
  current = null;
}
