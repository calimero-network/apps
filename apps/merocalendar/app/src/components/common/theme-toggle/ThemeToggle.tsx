import { useTheme } from "../../../providers/ThemeProvider";

/** Sun/moon button that flips the app theme. Used in app headers. */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      className="mc-theme-toggle"
      onClick={toggleTheme}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle color theme"
      data-testid="theme-toggle"
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
