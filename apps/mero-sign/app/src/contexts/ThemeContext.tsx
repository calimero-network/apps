import React, {
  createContext,
  useContext,
  useEffect,
  ReactNode,
} from 'react';

export type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
  mode: ThemeMode;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  // Light first: the app opens on the fleet's light glass. There is no theme
  // switch in this app; `html.dark` would turn @calimero-apps/glass into its
  // smoked (dark) variant, so it is no longer set.
  const mode: ThemeMode = 'light';

  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;

    // Remove old classes
    body.classList.remove('theme-light', 'theme-dark');
    html.classList.remove('dark', 'light');

    // Add the light theme classes
    body.classList.add('theme-light');
    html.classList.add('light');
  }, []);

  return (
    <ThemeContext.Provider value={{ mode }}>
      {children}
    </ThemeContext.Provider>
  );
};
