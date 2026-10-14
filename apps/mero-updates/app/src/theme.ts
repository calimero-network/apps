import { useCallback, useSyncExternalStore } from "react";

/* ══════════════════════════════════════════════════════════════════════════
 * Light / dark, chosen by the person.
 *
 * Light is the default for everyone; dark is the glass "smoked glass" look,
 * switched by `data-theme="dark"` on <html> (glass.css and index.css both key
 * their dark values off it). The choice is remembered under THEME_STORAGE_KEY,
 * which is this app's own: another Calimero app on the same origin keeps its
 * own choice.
 *
 * index.html carries an inline copy of `readStoredTheme` + `applyTheme` so the
 * saved theme is on <html> before the first paint and a reload never flashes
 * light; keep the key and the colours in step with it. The landing page's own
 * toggle writes the same key (scripts/landing/apps.config.mjs), so a choice
 * made there carries through sign-in.
 * ════════════════════════════════════════════════════════════════════════ */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "mero-updates:theme";

const THEME_EVENT = "mero-updates:theme-change";

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

/** The active theme plus setters. Every caller stays in step. */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void; toggleTheme: () => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light" as Theme);
  const toggleTheme = useCallback(() => setTheme(currentTheme() === "dark" ? "light" : "dark"), []);
  return { theme, setTheme, toggleTheme };
}
