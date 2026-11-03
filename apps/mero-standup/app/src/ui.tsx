import { useCallback, useEffect, useState, type ReactNode } from "react";
import { avatarHue, displayName, initials } from "./lib/people";
import { parseRich, type Inline } from "./lib/rich";

// ── avatar ──────────────────────────────────────────────────────────────────

/** Initials on a colour derived from the ACCOUNT, so a rename keeps it. */
export function Avatar({
  account,
  name,
  size = 32,
}: {
  account: string;
  name?: string | null;
  size?: number;
}) {
  const hue = avatarHue(account);
  return (
    <span
      className="avatar"
      title={displayName(account, name)}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: `hsl(${hue} 55% var(--avatar-l))`,
        color: `hsl(${hue} 70% var(--avatar-fg-l))`,
      }}
    >
      {initials(account, name)}
    </span>
  );
}

// ── rich text ───────────────────────────────────────────────────────────────

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "code" ? (
          <code key={i}>{p.text}</code>
        ) : p.kind === "link" ? (
          <a key={i} href={p.href} target="_blank" rel="noreferrer noopener">
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** Bullets, links and `code`, rendered as React nodes — never as HTML. */
export function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ? `rich ${className}` : "rich"}>
      {parseRich(text).map((b, i) =>
        b.kind === "list" ? (
          <ul key={i}>
            {b.items.map((item, j) => (
              <li key={j}>
                <Inlines parts={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            <Inlines parts={b.inlines} />
          </p>
        ),
      )}
    </div>
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
const THEME_KEY = "mero-standup:theme";

/** The stored choice, applied to <html> as `data-theme` ("system" = none). */
export function applyStoredTheme(): Theme {
  let theme: Theme = "system";
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") theme = stored;
  } catch {
    // Storage blocked: follow the system, which needs nothing stored.
  }
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  return theme;
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => applyStoredTheme());
  const choose = useCallback((t: Theme) => {
    try {
      if (t === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, t);
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
