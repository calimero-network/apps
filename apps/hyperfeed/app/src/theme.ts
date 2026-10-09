import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "hyperfeed:theme";

/** The theme you picked, else your system's. */
function initial(): Theme {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage can be off (private windows); the system's choice still applies.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Light or dark, on `<html data-theme>`, remembered on this device. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(KEY, theme);
    } catch {
      // Not remembered; it still applies now.
    }
  }, [theme]);
  return [theme, useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), [])];
}

/** How recently an agent must have reported in to count as running. */
export const AGENT_LIVE_MS = 90_000;
