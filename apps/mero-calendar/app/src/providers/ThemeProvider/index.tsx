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

export type Theme = "light" | "dark";

const STORAGE_KEY = "mc-theme";

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

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* ignore */
  }
  // Light first: no saved choice opens light, whatever the OS prefers.
  return "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  // Reflect the theme onto <html data-theme="…"> so the CSS variables apply.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(
    () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  return (
    <Ctx.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </Ctx.Provider>
  );
}
