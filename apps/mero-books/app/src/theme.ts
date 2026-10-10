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
  lineDark: 'rgba(11,143,199,0.14)',
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
 * Books design tokens (light).
 *
 * Accounting is read on paper as much as on screen, so the app views are a
 * light, high-contrast ledger palette with one blue accent: figures in ink,
 * negatives and overdue in red, paid in green. The landing page keeps its own
 * palette and never reads these.
 * ════════════════════════════════════════════════════════════════════════ */
export const tokens = {
  color: {
    bg: '#F4F6F9',
    panel: '#FFFFFF',
    raised: '#F7F9FC',
    raised2: '#EDF1F6',
    border: 'rgba(15,23,42,0.09)',
    borderStrong: 'rgba(15,23,42,0.16)',
    text: '#0F172A',
    text2: '#475467',
    text3: '#8A94A6',
    accent: '#0B8FC7',
    accentHover: '#0A7DAF',
    accentDim: 'rgba(11,143,199,0.10)',
    accentBorder: 'rgba(11,143,199,0.45)',
    onAccent: '#FFFFFF',
    hover: 'rgba(15,23,42,0.04)',
    urgent: '#D92D20',
    high: '#DC6803',
    medium: '#3E6FB0',
    low: '#8A94A6',
    done: '#079455',
    logBg: '#F7F9FC',
    danger: '#D92D20',
    dangerBorder: 'rgba(217,45,32,0.32)',
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

/** Document status colours (see utils/books documentStatus). */
export const STATUS_COLOR: Record<string, string> = {
  draft: tokens.color.text2,
  awaiting_payment: tokens.color.medium,
  overdue: tokens.color.urgent,
  paid: tokens.color.done,
  void: tokens.color.text3,
};

/** Wraps the app in the token theme (brief: ThemeProvider in App.tsx). */
export function AppThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  return React.createElement(ThemeProvider, { theme: tokens }, children);
}
