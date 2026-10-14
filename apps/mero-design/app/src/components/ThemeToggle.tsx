import { useTheme } from "../utils/theme";

interface Props {
  className?: string;
}

/** Sun/moon icon button that flips the app between light and dark glass. */
export default function ThemeToggle({ className }: Props) {
  const { theme, toggle } = useTheme();
  const label = theme === "dark" ? "Use light theme" : "Use dark theme";
  return (
    <button
      type="button"
      className={className}
      onClick={toggle}
      aria-label={label}
      title={label}
      data-testid="app-theme-toggle"
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <circle cx="10" cy="10" r="3.6" />
          <path d="M10 2.2v1.9M10 15.9v1.9M2.2 10h1.9M15.9 10h1.9M4.5 4.5l1.3 1.3M14.2 14.2l1.3 1.3M4.5 15.5l1.3-1.3M14.2 5.8l1.3-1.3" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
          <path d="M16.5 12.4A7 7 0 0 1 7.6 3.5a7 7 0 1 0 8.9 8.9Z" />
        </svg>
      )}
    </button>
  );
}
