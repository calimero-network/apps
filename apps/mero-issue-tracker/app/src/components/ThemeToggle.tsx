import React from 'react';
import styled from 'styled-components';
import { tokens as t, useTheme } from '../theme';
import { IconMoon, IconSun } from './icons';

/** Sun / moon button in the top bar: flips the tracker between light and dark. */
export default function ThemeToggle({ className }: { className?: string }): React.ReactElement {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'dark' ? 'Use light theme' : 'Use dark theme';
  return (
    <Btn
      type="button"
      className={className}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
    >
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
    </Btn>
  );
}

const Btn = styled.button`
  flex: 0 0 auto; width: 38px; height: 38px; border-radius: ${t.radiusPill};
  display: inline-grid; place-items: center; cursor: pointer;
  color: ${t.color.text2}; background: transparent; border: 1px solid transparent;
  transition: color 150ms ease-out, background 150ms ease-out;
  &:hover { color: ${t.color.text}; background: ${t.color.hover}; }
  &:focus-visible { outline: 2px solid var(--glass-accent); outline-offset: 2px; }
`;
