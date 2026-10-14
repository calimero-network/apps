import { useTheme } from "../../../providers/ThemeProvider";
import { MoonIcon, SunIcon } from "../icons/Icons";

/** Sun/moon button that flips the app theme. Used in app headers. */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      className="mc-theme-toggle"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      data-testid="theme-toggle"
    >
      {theme === "dark" ? <SunIcon size={18} /> : <MoonIcon size={18} />}
    </button>
  );
}
