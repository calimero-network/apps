// MeroDocs Theme Configuration
export const lightTheme = {
  colors: {
    primary: '#A9FF1F', // Bright green
    background: '#FFFFFF', // Light background
    surface: '#F8F9FA', // Light surface
    text: '#0E1011', // Dark text
    textSecondary: '#6C757D',
    muted: '#C5C0B9', // Muted text/borders
    border: '#E9ECEF',
    card: '#FFFFFF',
    shadow: 'rgba(0, 0, 0, 0.1)',
  },
  gradients: {
    primary: 'linear-gradient(135deg, #F8F9FA 0%, #E9ECEF 50%, #DEE2E6 100%)',
    accent: 'linear-gradient(135deg, #A9FF1F 0%, #8ce619 100%)',
    surface: 'linear-gradient(135deg, #FFFFFF 0%, #F8F9FA 100%)',
  },
  shadows: {
    card: '0 8px 32px rgba(0, 0, 0, 0.08)',
    button: '0 4px 16px rgba(169, 255, 31, 0.2)',
    large: '0 20px 40px rgba(0, 0, 0, 0.1)',
    sidebar: '2px 0 10px rgba(0, 0, 0, 0.1)',
  },
} as const;

export const darkTheme = {
  colors: {
    primary: '#A9FF1F', // Bright green
    background: '#0E1011', // Dark background
    surface: '#1A1D1F', // Dark surface
    text: '#E8E4E1', // Light text
    textSecondary: '#C5C0B9',
    muted: '#6C757D', // Muted text/borders
    border: '#2D3234',
    card: '#1A1D1F',
    shadow: 'rgba(169, 255, 31, 0.1)',
  },
  gradients: {
    primary: 'linear-gradient(135deg, #0E1011 0%, #1a1d1f 50%, #2d3234 100%)',
    accent: 'linear-gradient(135deg, #A9FF1F 0%, #8ce619 100%)',
    surface: 'linear-gradient(135deg, #1A1D1F 0%, #2D3234 100%)',
  },
  shadows: {
    card: '0 8px 32px rgba(169, 255, 31, 0.1)',
    button: '0 4px 16px rgba(169, 255, 31, 0.2)',
    large: '0 20px 40px rgba(14, 16, 17, 0.3)',
    sidebar: '2px 0 10px rgba(0, 0, 0, 0.5)',
  },
} as const;

export const commonTheme = {
  borders: {
    radius: {
      small: '8px',
      medium: '12px',
      large: '16px',
      xl: '24px',
    },
  },
  typography: {
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    sizes: {
      xs: '0.75rem',
      sm: '0.875rem',
      base: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
      '2xl': '1.5rem',
      '3xl': '1.875rem',
      '4xl': '2.25rem',
      '5xl': '3rem',
    },
    weights: {
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
  },
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    '2xl': '3rem',
  },
  mobile: {
    headerHeight: '60px',
    sidebarWidth: '280px',
    touchTarget: '44px',
  },
} as const;

export type ThemeMode = 'light' | 'dark';
export type Theme = (typeof lightTheme | typeof darkTheme) & typeof commonTheme;

export const getTheme = (mode: ThemeMode) => ({
  ...(mode === 'light' ? lightTheme : darkTheme),
  ...commonTheme,
});

export const theme = getTheme('dark');
