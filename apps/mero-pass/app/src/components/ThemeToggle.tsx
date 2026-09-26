import { useState } from 'react';
import { Moon, Sun } from '@calimero-network/mero-icons';

import { type ThemeMode, chooseTheme, currentTheme } from '../lib/theme';

/**
 * A 32px square that flips light and dark. Saves only when pressed; see
 * `lib/theme`.
 */
export default function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>(currentTheme);
  const dark = mode === 'dark';
  return (
    <button
      type="button"
      className={`mp-theme-toggle ${className ?? ''}`}
      onClick={() => {
        const next: ThemeMode = dark ? 'light' : 'dark';
        chooseTheme(next);
        setMode(next);
      }}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={dark}
      title={dark ? 'Light mode' : 'Dark mode'}
      data-testid="theme-toggle"
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
