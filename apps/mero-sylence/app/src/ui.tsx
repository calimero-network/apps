import { useCallback, useEffect, useState, type ReactNode } from "react";
import { displayName, initials } from "./lib/people";
import { useSpaceNames } from "./names";

// ── avatar ──────────────────────────────────────────────────────────────────

/** Initials on a neutral disc. */
export function Avatar({
  account,
  name,
  size = 32,
}: {
  account: string;
  name?: string | null;
  size?: number;
}) {
  const spaceName = useSpaceNames().nameOf(account);
  return (
    <span
      className="avatar"
      title={displayName(account, name, spaceName)}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
      }}
    >
      {initials(account, name, spaceName)}
    </span>
  );
}

// ── icons ───────────────────────────────────────────────────────────────────
// A handful of 16px strokes, inline so they follow `currentColor` in both
// themes. No emoji: a bitmap glyph cannot follow the palette.

const paths: Record<string, ReactNode> = {
  left: <path d="M10 3 5 8l5 5" />,
  right: <path d="m6 3 5 5-5 5" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" />
    </>
  ),
  moon: <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />,
  copy: (
    <>
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </>
  ),
  hand: <path d="M5 8V3.5a1 1 0 0 1 2 0V7m0-1V2.5a1 1 0 0 1 2 0V7m0-3.5a1 1 0 0 1 2 0V8m0-2.5a1 1 0 0 1 2 0V10a5 5 0 0 1-5 5H8a4 4 0 0 1-3.2-1.6L2.3 10a1 1 0 0 1 1.5-1.3L5 10" />,
  check: <path d="m3 8.5 3 3 7-7" />,
  pen: <path d="m10.5 2.5 3 3L6 13H3v-3l7.5-7.5Z" />,
  plus: <path d="M8 3v10M3 8h10" />,
  menu: <path d="M3 4h10M3 8h10M3 12h10" />,
  up: <path d="m3 10 5-5 5 5" />,
  down: <path d="m3 6 5 5 5-5" />,
  x: <path d="m4 4 8 8M12 4l-8 8" />,
  trash: <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" />,
  form: (
    <>
      <rect x="3" y="2" width="10" height="12" rx="1.5" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
    </>
  ),
  send: <path d="M2 8 14 2l-4 12-2.5-5L2 8Z" />,
  download: <path d="M8 2v8m-3.5-3.5L8 10l3.5-3.5M2.5 13.5h11" />,
  mic: (
    <>
      <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" />
      <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </>
  ),
  video: (
    <>
      <rect x="1.5" y="4" width="9" height="8" rx="1.5" />
      <path d="m10.5 7 4-2.5v7l-4-2.5" />
    </>
  ),
  wave: <path d="M2 8h1M4.5 5v6M7 3v10M9.5 5.5v5M12 6.5v3M14 8h0" />,
  list: <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h0M2.5 8h0M2.5 12h0" />,
  puzzle: <path d="M3 5h2.5a1.5 1.5 0 1 1 3 0H11v2.5a1.5 1.5 0 1 1 0 3V13H8.5a1.5 1.5 0 1 0-3 0H3v-2.5a1.5 1.5 0 1 0 0-3V5Z" />,
  play: <path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5Z" fill="currentColor" />,
  pause: (
    <>
      <rect x="4" y="3" width="2.6" height="10" rx=".8" fill="currentColor" />
      <rect x="9.4" y="3" width="2.6" height="10" rx=".8" fill="currentColor" />
    </>
  ),
  back: <path d="M3 3v3.5h3.5M3.4 6.2A5.5 5.5 0 1 1 3 9.5" />,
  forward: <path d="M13 3v3.5H9.5M12.6 6.2A5.5 5.5 0 1 0 13 9.5" />,
  follow: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5" />
    </>
  ),
  upload: <path d="M8 11V2.5M4.5 6 8 2.5 11.5 6M2.5 13.5h11" />,
  users: (
    <>
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M1.5 13.5a4.5 4.5 0 0 1 9 0M10.5 3.2a2.5 2.5 0 0 1 0 4.6M12 9.3a4.5 4.5 0 0 1 2.5 4.2" />
    </>
  ),
  sparkle: <path d="M8 1.5 9.4 6.6 14.5 8l-5.1 1.4L8 14.5 6.6 9.4 1.5 8l5.1-1.4L8 1.5Z" />,
  key: (
    <>
      <circle cx="5.5" cy="10.5" r="3" />
      <path d="m7.6 8.4 6-6M11.5 4.5l2 2M10 6l1.5 1.5" />
    </>
  ),
  home: <path d="M2.5 7 8 2.5 13.5 7v6.5h-3.5v-4H6v4H2.5V7Z" />,
  logout: <path d="M6 2.5H3.5v11H6M10.5 5l3 3-3 3M13.5 8H6.5" />,
  link: <path d="M7 9a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9 7a3 3 0 0 0-4.2 0l-2 2A3 3 0 0 0 7 13.2l.8-.8" />,
  building: (
    <>
      <rect x="3" y="2" width="10" height="12" rx="1" />
      <path d="M6 5h1M9 5h1M6 8h1M9 8h1M7 14v-3h2v3" />
    </>
  ),
  help: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M6.2 6.2a1.9 1.9 0 0 1 3.6.7c0 1.3-1.8 1.6-1.8 2.8M8 11.5h0" />
    </>
  ),
};

export function Icon({ name, size = 16 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="icon"
    >
      {paths[name]}
    </svg>
  );
}

// ── theme ───────────────────────────────────────────────────────────────────

export type Theme = "system" | "light" | "dark";
const THEME_KEY = "mero-sylence:theme";

/** The stored choice, applied to <html> as `data-theme` ("system" = none). */
export function applyStoredTheme(): Theme {
  // Light unless the person chose dark or "follow the system".
  let theme: Theme = "light";
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") theme = stored;
  } catch {
    // Storage blocked: light, the default.
  }
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  return theme;
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => applyStoredTheme());
  const choose = useCallback((t: Theme) => {
    try {
      window.localStorage.setItem(THEME_KEY, t);
    } catch {
      // A per-browser convenience; failing to remember it is harmless.
    }
    setTheme(t);
  }, []);
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  return [theme, choose];
}

// ── keyboard ────────────────────────────────────────────────────────────────

/** Cmd+Enter on a Mac, Ctrl+Enter elsewhere: submit from inside a textarea. */
export function isSubmitShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean }) {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey);
}

export const SUBMIT_HINT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘ Enter"
    : "Ctrl Enter";
