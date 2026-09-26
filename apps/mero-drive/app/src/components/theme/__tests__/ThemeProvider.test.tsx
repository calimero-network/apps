import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../ThemeProvider';

function Probe() {
  const { theme, toggle } = useTheme();
  return <button onClick={toggle}>theme:{theme}</button>;
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('defaults to light without the dark class', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByRole('button').textContent).toBe('theme:light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('toggles to dark, adds the class, and persists', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('theme:dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('mero-theme')).toBe('"dark"');
  });

  it('reads a persisted theme on mount', () => {
    localStorage.setItem('mero-theme', '"dark"');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByRole('button').textContent).toBe('theme:dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
