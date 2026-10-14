import { useCallback, useSyncExternalStore } from "react";

// Light / dark for Chat. Light is the default; dark is the glass "smoked
// glass" look, switched by `data-theme="dark"` on <html> (glass.css and
// index.css both key their dark tokens off it).
//
// index.html carries an inline copy of `readStoredTheme` + `applyTheme` so the
// right theme is on <html> before the first paint; keep the key in step.

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "mero-chat:theme";

const THEME_EVENT = "mero-chat:theme-change";

// The browser chrome colour (PWA title bar, mobile address bar) follows the
// glass ground of each theme.
const THEME_COLOR: Record<Theme, string> = {
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

export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", THEME_COLOR[theme]));
}

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

/** The active theme, plus setters. Every caller stays in step. */
export function useTheme(): {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
} {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light" as Theme);
  const toggleTheme = useCallback(
    () => setTheme(currentTheme() === "dark" ? "light" : "dark"),
    [],
  );
  return { theme, setTheme, toggleTheme };
}
