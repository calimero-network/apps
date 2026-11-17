import { MoonIcon, SunIcon } from "./icons";
import { useTheme } from "./theme";

/** Sun / moon button in the top bar: flips Hyperfeed Vote between light and dark. */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "Use light theme" : "Use dark theme";
  return (
    <button
      type="button"
      className="icon-btn round"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
    >
      {theme === "dark" ? <SunIcon size={18} /> : <MoonIcon size={18} />}
    </button>
  );
}
