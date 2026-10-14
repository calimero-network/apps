import React, { useCallback, useEffect, useState } from 'react';
import { ThemeProvider } from 'styled-components';

/**
 * App theme — light / dark.
 *
 * The palette is exposed as CSS custom properties (defined in index.css under
 * `:root` and `:root[data-theme="dark"]`), so `C.*` are `var(--c-*)` references
 * that flip automatically when the `data-theme` attribute changes. Every app
 * surface imports `C` from here.
 *
 * NOTE: the landing page keeps its own hard-coded light palette and is NOT
 * themed (by product decision) — it never reads these vars.
 *
 * `onAccent` is the text/icon colour that sits ON the bright green accent
 * (buttons, avatars). Green is bright in both themes, so this stays dark.
 */
export const C = {
  green: 'var(--c-green)',
  greenHover: 'var(--c-green-hover)',
  greenDeep: 'var(--c-green-deep)',
  greenInk: 'var(--c-green-ink)',
  onAccent: 'var(--c-on-accent)',
  ink: 'var(--c-ink)',
  paper: 'var(--c-paper)',
  paper2: 'var(--c-paper2)',
  line: 'var(--c-line)',
  lineDark: 'rgba(164,255,17,0.14)',
  muted: 'var(--c-muted)',
  mutedSoft: 'var(--c-muted-soft)',
  off: 'var(--c-off)',
  disabled: 'var(--c-disabled)',
  danger: 'var(--c-danger)',
} as const;

export type ThemeMode = 'light' | 'dark';
const STORAGE_KEY = 'app:theme';

export function getStoredTheme(): ThemeMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Apply the theme to <html> so the CSS vars resolve. Call once before render. */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = mode;
}

/** React state + persistence for the active theme. */
export function useTheme(): { theme: ThemeMode; toggle: () => void } {
  const [theme, setTheme] = useState<ThemeMode>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return { theme, toggle };
}

/**
 * Moon icon for the theme toggle: OUTLINE in light mode, FILLED in dark mode.
 */
export function MoonIcon({ filled, size = 17 }: { filled: boolean; size?: number }): React.ReactElement {
  return React.createElement(
    'svg',
    {
      width: size, height: size, viewBox: '0 0 24 24',
      fill: filled ? 'currentColor' : 'none',
      stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': true,
    },
    React.createElement('path', { d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' }),
  );
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
