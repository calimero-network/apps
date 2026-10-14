/**
 * ThemeToggle — the sun / moon button in the top bar. Flips the whole app
 * between the light glass look (the default) and dark, and remembers it.
 */
import styled from 'styled-components';
import { useTheme } from '../theme';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label = theme === 'dark' ? 'Use light theme' : 'Use dark theme';
  return (
    <Button type="button" onClick={toggle} aria-label={label} title={label} data-testid="theme-toggle">
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

const MoonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

const Button = styled.button`
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--glass-ink-2);
  background: transparent;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: color 0.2s ease, background-color 0.2s ease;
  &:hover { color: var(--glass-ink); background: color-mix(in srgb, var(--glass-ink) 9%, transparent); }
  &:focus-visible { outline: 2px solid var(--glass-accent); outline-offset: 2px; }
`;
