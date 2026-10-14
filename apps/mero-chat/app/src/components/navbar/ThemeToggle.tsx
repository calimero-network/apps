import { styled } from "styled-components";
import { useTheme } from "../../theme/theme";

const ToggleButton = styled.button`
  border: none;
  background: transparent;
  color: var(--glass-ink-2);
  width: 36px;
  height: 36px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
  &:hover {
    color: var(--glass-ink);
    background-color: color-mix(in srgb, var(--glass-ink) 10%, transparent);
  }
  &:focus-visible {
    outline: 2px solid var(--glass-accent);
    outline-offset: 2px;
  }
`;

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

/** Sun / moon button in the top bar: flips Chat between light and dark. */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "Use light theme" : "Use dark theme";
  return (
    <ToggleButton
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </ToggleButton>
  );
}
