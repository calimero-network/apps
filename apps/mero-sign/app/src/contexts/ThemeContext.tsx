import React, { type ReactNode } from 'react';
import {
  applyTheme,
  readStoredTheme,
  useThemeChoice,
  type Theme,
} from '../theme';

export type ThemeMode = Theme;

/**
 * The theme, for components. `mode` is the active theme (kept under that name
 * for the components that already read it); `toggleTheme` is what the top
 * bar's sun/moon button calls. The state itself lives in `src/theme.ts`, an
 * external store, so every caller stays in step without a provider in the
 * way — `ThemeProvider` only makes sure <html> carries the saved choice.
 */
export const useTheme = () => {
  const { theme, setTheme, toggleTheme } = useThemeChoice();
  return { mode: theme, theme, setTheme, toggleTheme };
};

interface ThemeProviderProps {
  children: ReactNode;
}

// Light unless the person picked dark. index.html already applied this before
// the first paint; doing it again as this module loads covers a page with no
// inline script (the screenshot harness) and is a no-op otherwise. At module
// scope rather than in an effect so the first render already reads it.
applyTheme(readStoredTheme());

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => (
  <>{children}</>
);
