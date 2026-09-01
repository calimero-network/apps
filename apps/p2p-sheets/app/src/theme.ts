import React, { useCallback, useEffect, useState } from 'react';

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
  chrome: 'var(--c-chrome)',
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
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
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
