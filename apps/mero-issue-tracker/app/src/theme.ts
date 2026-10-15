import React, { useCallback, useSyncExternalStore } from 'react';
import { ThemeProvider } from 'styled-components';

/* ══════════════════════════════════════════════════════════════════════════
 * Light / dark, chosen by the person.
 *
 * Light is the default for everyone; dark is the glass "smoked glass" look,
 * switched by `data-theme="dark"` on <html> (glass.css and index.css both key
 * their dark values off it). The choice is remembered under THEME_STORAGE_KEY.
 * It used to live under `app:theme`, a key every app served from the same
 * origin shared, so one app's choice leaked into the next; that key is no
 * longer read.
 *
 * index.html carries an inline copy of `readStoredTheme` + `applyTheme` so the
 * saved theme is on <html> before the first paint and a reload never flashes
 * light; keep the key and the colours in step with it. The landing page's own
 * toggle writes the same key (scripts/landing/apps.config.mjs), so a choice
 * made there carries through sign-in.
 * ════════════════════════════════════════════════════════════════════════ */

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'mero-issue-tracker:theme';

const THEME_EVENT = 'mero-issue-tracker:theme-change';

/** Browser chrome colour (PWA title bar, mobile address bar): the glass ground. */
export const THEME_COLOR: Record<Theme, string> = {
  light: '#f6f7fb',
  dark: '#0b0e18',
};

export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** The theme <html> is in right now. */
export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** Put a theme on <html> (and the browser chrome) without remembering it. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute('content', THEME_COLOR[theme]));
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
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** The active theme plus setters. Every caller stays in step. */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void; toggleTheme: () => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'light' as Theme);
  const toggleTheme = useCallback(() => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'), []);
  return { theme, setTheme, toggleTheme };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Issue-tracker design tokens: the fleet's light glass (@calimero-apps/glass).
 *
 * Every colour is a `var(--it-*)` reference. index.css maps those onto the
 * shared `--glass-*` values, light by default, and onto smoked glass when
 * `<html data-theme="dark">` is set (see `applyTheme` above), so every view
 * follows the same light/dark switch.
 *
 * `accent` is the primary-control fill (the glass near-black ink) with
 * `onAccent` text on it; `accentText` is accent-coloured TEXT and marks
 * (links, checks, the active nav icon). `glass` is the frosted frame surface
 * (rail, header, panels, board lanes); content that floats or holds dense
 * text (cards, menus, dialogs) is the solid `panel`.
 *
 * ⚠️ `backdrop-filter` (what makes `glass` frosted) turns an element into the
 * containing block of every `position: fixed` descendant. A dialog, menu or
 * drawer rendered INSIDE a frosted surface is trapped in it, so render them as
 * siblings of the frosted panels, or portal them to <body>.
 * ════════════════════════════════════════════════════════════════════════ */
export const tokens = {
  color: {
    bg: 'var(--it-bg)',
    panel: 'var(--it-panel)',
    /** Frosted frame surface (rail, header, panels). Never for floating layers. */
    glass: 'var(--it-glass)',
    /** Board lane: a lighter frost than a panel, so the cards on it lead. */
    lane: 'var(--it-lane)',
    raised: 'var(--it-raised)',
    raised2: 'var(--it-raised2)',
    hover: 'var(--it-hover)',
    border: 'var(--it-border)',
    borderStrong: 'var(--it-border-strong)',
    edge: 'var(--it-edge)',
    text: 'var(--it-text)',
    text2: 'var(--it-text2)',
    text3: 'var(--it-text3)',
    accent: 'var(--it-accent)',
    accentHover: 'var(--it-accent-hover)',
    accentText: 'var(--it-accent-text)',
    accentDim: 'var(--it-accent-dim)',
    accentBorder: 'var(--it-accent-border)',
    onAccent: 'var(--it-on-accent)',
    /** Dark text on the bright avatar swatches, in both themes. */
    onSwatch: '#0e1222',
    scrim: 'var(--it-scrim)',
    open: 'var(--it-open)',
    urgent: 'var(--it-urgent)',
    high: 'var(--it-high)',
    medium: 'var(--it-medium)',
    low: 'var(--it-low)',
    done: 'var(--it-done)',
    goodBg: 'var(--it-good-bg)',
    badBg: 'var(--it-bad-bg)',
    logBg: 'var(--it-log-bg)',
    // Semantic destructive colour (delete/remove). A muted red, distinct from
    // the accent; `dangerBorder` is its translucent hairline variant.
    danger: 'var(--it-danger)',
    dangerBorder: 'var(--it-danger-border)',
  },
  shadow: 'var(--it-shadow)',
  shadowFloat: 'var(--it-shadow-float)',
  /** Solid content card on glass; `shadowLift` is its hover. */
  shadowCard: 'var(--it-shadow-card)',
  shadowLift: 'var(--it-shadow-lift)',
  /** Soft focus halo for inputs and buttons. */
  focus: 'var(--it-focus)',
  blur: 'var(--glass-blur)',
  radius: '12px',
  radiusSm: '10px',
  radiusCard: '16px',
  radiusLg: '20px',
  radiusModal: '22px',
  radiusPill: '999px',
  font: {
    sans: 'var(--glass-font)',
    mono: 'ui-monospace, "SF Mono", "Menlo", "Cascadia Code", monospace',
  },
} as const;

export type Tokens = typeof tokens;

/** Ordered issue statuses (match the backend + e2e). */
export const STATUSES = ['Open', 'In progress', 'Blocked', 'Done'] as const;
/** Ordered issue priorities, low → urgent. */
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

/** Status-dot colour per status. */
export const STATUS_COLOR: Record<string, string> = {
  Open: tokens.color.open,
  'In progress': tokens.color.high,
  Blocked: tokens.color.urgent,
  Done: tokens.color.done,
};

/** Priority-glyph colour per priority. */
export const PRIORITY_COLOR: Record<string, string> = {
  low: tokens.color.low,
  medium: tokens.color.medium,
  high: tokens.color.high,
  urgent: tokens.color.urgent,
};

/** Wraps the tracker in the glass token theme (brief: ThemeProvider in App.tsx). */
export function AppThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  return React.createElement(ThemeProvider, { theme: tokens }, children);
}
