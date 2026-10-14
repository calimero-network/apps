import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import styles from './AppShell.module.css';

/** Sun / moon button in the top bar: flips Mero Sign between light and dark. */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'dark' ? 'Use light theme' : 'Use dark theme';
  return (
    <button
      type="button"
      className={styles.iconBtn}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
