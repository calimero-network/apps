import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// FEATURE (dark/light mode): a ThemeProvider that toggles a `data-theme`
// attribute on <html>, persisted to localStorage and defaulting to LIGHT (the
// fleet's glass look opens light for everyone; dark is the user's choice
// through the toggle, and a saved choice is always kept). All calendar/app colors are CSS custom properties (see
// src/styles/theme.css) keyed off [data-theme], so flipping the attribute
// re-themes the whole app with no React re-render of the calendar.
//
// index.html carries an inline copy of `readStoredTheme` + `applyTheme` so the
// saved theme is on <html> before the first paint (no light flash on a dark
// reload); keep the key and the colours in step with it.

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "mc-theme";

// The browser chrome colour (PWA title bar, mobile address bar) follows the
// glass ground of each theme.
const THEME_COLOR: Record<Theme, string> = {
  light: "#f6f7fb",
  dark: "#0b0e18",
};

interface ThemeCtx {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<ThemeCtx>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
});

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}

function readStoredTheme(): Theme {
  try {
    if (localStorage.getItem(THEME_STORAGE_KEY) === "dark") return "dark";
  } catch {
    /* ignore */
  }
  // Light first: no saved choice opens light, whatever the OS prefers.
  return "light";
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", THEME_COLOR[theme]));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  // Reflect the theme onto <html data-theme="…"> so the CSS variables apply.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Only an explicit choice is written. Writing the default on mount made
  // "light because nobody chose" indistinguishable from "light on purpose".
  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t);
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
    setThemeState(t);
  }, []);
  const toggleTheme = useCallback(
    () => setTheme(theme === "dark" ? "light" : "dark"),
    [setTheme, theme],
  );

  return (
    <Ctx.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </Ctx.Provider>
  );
}
