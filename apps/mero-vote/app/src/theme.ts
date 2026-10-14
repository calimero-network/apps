// Light / dark, chosen by the person.
//
// Light is the default for everyone; dark is the fleet's "smoked glass", switched
// by `data-theme="dark"` on <html> (glass.css and index.css both key their dark
// values off it). The choice is remembered under THEME_STORAGE_KEY, which is
// Mero Vote's own: another app on the same origin keeps its own choice.
//
// index.html carries an inline copy of `readStoredTheme` + `applyTheme` so a
// saved dark theme is on <html> before the first paint and a reload never
// flashes light; keep the key and the colours in step with it.

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "mero-vote:theme";

const THEME_EVENT = "mero-vote:theme-change";

/** Browser chrome colour (PWA title bar, mobile address bar): the glass ground. */
export const THEME_COLOR: Record<Theme, string> = {
  light: "#f6f7fb",
  dark: "#0b0e18",
};

export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** The theme <html> is in right now. */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

/** Put a theme on <html> (and the browser chrome) without remembering it. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", THEME_COLOR[theme]));
}

/** Remember a theme and apply it; every `useTheme` caller follows. */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  // Another tab changed it: follow along.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    applyTheme(readStoredTheme());
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The active theme plus a toggle. Every caller stays in step. */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light" as Theme);
  const toggleTheme = useCallback(() => setTheme(currentTheme() === "dark" ? "light" : "dark"), []);
  return { theme, toggleTheme };
}
