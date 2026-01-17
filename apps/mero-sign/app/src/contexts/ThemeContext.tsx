import React, {
  createContext,
  useContext,
  useEffect,
  ReactNode,
} from 'react';

export type ThemeMode = 'dark';

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
  const mode: ThemeMode = 'dark';

  useEffect(() => {
    // Always set dark mode
    const body = document.body;
    const html = document.documentElement;
    
    // Remove old classes
    body.classList.remove('theme-light', 'theme-dark');
    html.classList.remove('dark', 'light');
    
    // Add dark theme classes
    body.classList.add('theme-dark');
    html.classList.add('dark');
  }, []);

  return (
    <ThemeContext.Provider value={{ mode }}>
      {children}
    </ThemeContext.Provider>
  );
};
