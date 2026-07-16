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
 * Issue-tracker design tokens (Linear-grade, dark-only).
 *
 * These are the exact values from docs/superpowers/design/mockup.html and are
 * hard-coded dark: the tracker views do NOT follow the light/dark toggle above
 * (which only the landing/login surfaces use via the `C` CSS-var palette).
 * ════════════════════════════════════════════════════════════════════════ */
export const tokens = {
  color: {
    bg: '#0E0F12',
    panel: '#16181D',
    raised: '#1C1F26',
    raised2: '#23262F',
    border: 'rgba(255,255,255,0.07)',
    borderStrong: 'rgba(255,255,255,0.12)',
    text: '#E6E8EC',
    text2: '#9BA1AD',
    text3: '#6B707B',
    accent: '#A5FF3F',
    accentDim: 'rgba(165,255,63,0.14)',
    accentBorder: 'rgba(165,255,63,0.35)',
    onAccent: '#0C1005',
    urgent: '#E5695F',
    high: '#E0A04B',
    medium: '#6E8BB5',
    low: '#6B707B',
    done: '#7FC96B',
    logBg: '#0A0B0D',
  },
  radius: '6px',
  radiusSm: '4px',
  radiusModal: '10px',
  font: {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif',
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
  Open: '#8A909C',
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

/** Wraps the tracker in the dark token theme (brief: ThemeProvider in App.tsx). */
export function AppThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  return React.createElement(ThemeProvider, { theme: tokens }, children);
}
