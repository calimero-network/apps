import { useTheme } from "../theme";
import { MoonIcon, SunIcon } from "./icons";

/** Sun / moon button in the top bar: flips Mero Updates between light and dark. */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "Use light theme" : "Use dark theme";
  return (
    <button
      type="button"
      className="iconBtn themeToggle"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
    >
      {theme === "dark" ? <SunIcon size={18} /> : <MoonIcon size={18} />}
    </button>
  );
}
