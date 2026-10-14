import React, { useCallback, useSyncExternalStore } from 'react';

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
 * `onAccent` is the text/icon colour that sits ON the accent fill (buttons,
 * avatars): the glass on-ink, which flips with the theme like the fill does.
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
  lineDark: 'var(--glass-line)',
  muted: 'var(--c-muted)',
  mutedSoft: 'var(--c-muted-soft)',
  off: 'var(--c-off)',
  disabled: 'var(--c-disabled)',
  danger: 'var(--c-danger)',
} as const;

export type ThemeMode = 'light' | 'dark';

/** Where the choice is kept. index.html reads the same keys before the first
 *  paint (so a dark user never sees a light flash); keep the two in step. */
export const THEME_STORAGE_KEY = 'mero-sheets:theme';
/** The generic key this app used before it had its own. Read once, moved over. */
export const LEGACY_THEME_KEY = 'app:theme';

/** The browser chrome colour (PWA title bar, mobile address bar) per theme:
 *  the glass ground. */
const THEME_COLOR: Record<ThemeMode, string> = { light: '#f6f7fb', dark: '#0b0e18' };

/** Light first: only a saved "dark" opens dark (the fleet's glass look opens
 *  light for everyone; the toggle and a saved choice still win). A choice made
 *  under the old key is honoured and moved to the new one. */
export function getStoredTheme(): ThemeMode {
  try {
    let saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === null) {
      saved = localStorage.getItem(LEGACY_THEME_KEY);
      if (saved !== null) {
        localStorage.setItem(THEME_STORAGE_KEY, saved);
        localStorage.removeItem(LEGACY_THEME_KEY);
      }
    }
    return saved === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Apply the theme to <html> so the CSS vars resolve. Call once before render. */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = mode;
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute('content', THEME_COLOR[mode]));
}

const listeners = new Set<() => void>();
let current: ThemeMode | null = null;

function snapshot(): ThemeMode {
  if (current === null) current = getStoredTheme();
  return current;
}

/** Switch, remember and apply; every `useTheme` caller re-renders. */
export function setTheme(mode: ThemeMode): void {
  current = mode;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
  applyTheme(mode);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab switching keeps this one in step.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    current = getStoredTheme();
    applyTheme(current);
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The active theme and a toggle. Every caller stays in step. */
export function useTheme(): { theme: ThemeMode; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, snapshot, () => 'light' as ThemeMode);
  const toggle = useCallback(() => setTheme(snapshot() === 'dark' ? 'light' : 'dark'), []);
  return { theme, toggle };
}

/** Test-only: forget the cached choice so the next read goes to storage. */
export function resetThemeForTests(): void {
  current = null;
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
