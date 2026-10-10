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

/** Whether any agent has reported in to this feed recently enough to count as running. */
export function agentLive(agents: { seen_at: number }[] | undefined, now = Date.now()): boolean {
  return (agents ?? []).some((a) => now - a.seen_at < AGENT_LIVE_MS);
}

/**
 * What to tell you about a message nothing has picked up, from what the feed
 * knows instead of a guess: no agent has reported in, or one has but has not
 * reached your message yet.
 */
export function notPickedUp(live: boolean): string {
  return live
    ? "Your agent is connected but hasn't picked this up yet. It checks for waiting messages every 30 seconds."
    : "mero-bot isn't connected to this feed: no agent has reported in for 90 seconds. Start it, or restart it if its login expired, and it answers this.";
}
