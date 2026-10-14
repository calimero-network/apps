import React, { useCallback, useSyncExternalStore } from 'react';
import { ThemeProvider } from 'styled-components';

/* ══════════════════════════════════════════════════════════════════════════
 * Light / dark, chosen by the person.
 *
 * Light is the default for everyone; dark is the glass "smoked glass" look,
 * switched by `data-theme="dark"` on <html> (glass.css and index.css both key
 * their dark values off it). The choice is remembered under THEME_STORAGE_KEY.
 *
 * index.html carries an inline copy of `readStoredTheme` + `applyTheme` so the
 * saved theme is on <html> before the first paint and a reload never flashes
 * light; keep the key and the colours in step with it. The landing page's own
 * toggle writes the same key (scripts/landing/apps.config.mjs), so a choice
 * made there carries through sign-in.
 * ════════════════════════════════════════════════════════════════════════ */

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'mero-crm:theme';

const THEME_EVENT = 'mero-crm:theme-change';

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
 * CRM design tokens: the fleet's light glass (@calimero-apps/glass).
 *
 * Every colour is a `var(--crm-*)` reference. index.css maps those onto the
 * shared `--glass-*` values, light by default, and onto smoked glass when
 * `<html data-theme="dark">` is set (see `applyTheme` above), so the app views
 * now follow the same light/dark switch as everything else.
 *
 * `accent` is the primary-control fill (the glass ink) with `onAccent` text on
 * it; `accentText` is accent-coloured TEXT and marks (links, checks, bars).
 * ════════════════════════════════════════════════════════════════════════ */
export const tokens = {
  color: {
    bg: 'var(--crm-bg)',
    panel: 'var(--crm-panel)',
    /** Frosted frame surface (sidebar, columns, panels). Never for content. */
    glass: 'var(--crm-glass)',
    raised: 'var(--crm-raised)',
    raised2: 'var(--crm-raised2)',
    hover: 'var(--crm-hover)',
    border: 'var(--crm-border)',
    borderStrong: 'var(--crm-border-strong)',
    edge: 'var(--crm-edge)',
    text: 'var(--crm-text)',
    text2: 'var(--crm-text2)',
    text3: 'var(--crm-text3)',
    accent: 'var(--crm-accent)',
    accentHover: 'var(--crm-accent-hover)',
    accentText: 'var(--crm-accent-text)',
    accentDim: 'var(--crm-accent-dim)',
    accentBorder: 'var(--crm-accent-border)',
    onAccent: 'var(--crm-on-accent)',
    /** Dark text on the bright avatar swatches, in both themes. */
    onSwatch: '#0e1222',
    scrim: 'var(--crm-scrim)',
    urgent: 'var(--crm-urgent)',
    high: 'var(--crm-high)',
    medium: 'var(--crm-medium)',
    low: 'var(--crm-low)',
    done: 'var(--crm-done)',
    goodBg: 'var(--crm-good-bg)',
    badBg: 'var(--crm-bad-bg)',
    logBg: 'var(--crm-log-bg)',
    // Semantic destructive colour (delete/remove). A muted red, distinct from
    // the accent; `dangerBorder` is its translucent hairline variant.
    danger: 'var(--crm-danger)',
    dangerBorder: 'var(--crm-danger-border)',
  },
  shadow: 'var(--crm-shadow)',
  shadowFloat: 'var(--crm-shadow-float)',
  blur: 'var(--glass-blur)',
  radius: '10px',
  radiusSm: '8px',
  radiusModal: '20px',
  radiusLg: '16px',
  radiusPill: '999px',
  font: {
    sans: 'var(--glass-font)',
    mono: 'ui-monospace, "SF Mono", "Menlo", "Cascadia Code", monospace',
  },
} as const;

export type Tokens = typeof tokens;

/** Deal-health colours (see utils/crm dealHealth). */
export const HEALTH_COLOR: Record<string, string> = {
  healthy: tokens.color.done,
  'at-risk': tokens.color.high,
  critical: tokens.color.urgent,
};

/** Due-date tone colours for activity chips. */
export const DUE_COLOR: Record<string, string> = {
  overdue: tokens.color.urgent,
  today: tokens.color.accent,
  soon: tokens.color.text2,
  later: tokens.color.text3,
};

/** Wraps the app in the glass token theme (brief: ThemeProvider in App.tsx). */
export function AppThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  return React.createElement(ThemeProvider, { theme: tokens }, children);
}
