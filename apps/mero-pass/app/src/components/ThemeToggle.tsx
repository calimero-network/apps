import { Moon, Sun } from '@calimero-network/mero-icons';

import { type ThemeMode, chooseTheme, useTheme } from '../lib/theme';

/**
 * A round button that flips light and dark. Saves only when pressed; see
 * `lib/theme`.
 */
export default function ThemeToggle({ className }: { className?: string }) {
  const dark = useTheme() === 'dark';
  return (
    <button
      type="button"
      className={`mp-theme-toggle ${className ?? ''}`}
      onClick={() => {
        const next: ThemeMode = dark ? 'light' : 'dark';
        chooseTheme(next);
      }}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={dark}
      title={dark ? 'Light mode' : 'Dark mode'}
      data-testid="theme-toggle"
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
