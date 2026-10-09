import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../../theme";
import LoginPopup from "./loginPopup";

export const GITHUB = "https://github.com/calimero-network/apps/tree/main/apps/hyperfeed";
export const DOWNLOAD = "https://calimero.network/download";

/** The connect dialog every "Open your feed" button opens. */
export function useConnect() {
  const [open, setOpen] = useState(false);
  return {
    connect: () => setOpen(true),
    dialog: <LoginPopup isOpen={open} onClose={() => setOpen(false)} />,
  };
}

function ThemeButton() {
  const [theme, toggle] = useTheme();
  return (
    <button type="button" className="hl-icon" aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"} onClick={toggle}>
      {theme === "dark" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}

/** The page for signed-out visitors: the header, the content, the footer and the connect dialog. */
export function LandingShell({ page, connect, children }: { page: "home" | "docs"; connect: () => void; children: ReactNode }) {
  return (
    <div className="hl">
      <header className="hl-header">
        <nav className="hl-wrap hl-nav" aria-label="Main">
          <Link to="/" className="hl-brand">
            <img src="/favicon.svg" alt="" width={26} height={26} />
            hyperfeed
          </Link>
          <div className="hl-links">
            <a className="hl-link" href={page === "home" ? "#lanes" : "/#lanes"}>
              Product
            </a>
            <Link className="hl-link" to="/docs" aria-current={page === "docs" ? "page" : undefined}>
              Docs
            </Link>
            <a className="hl-link" href={GITHUB} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
          <div className="hl-nav-end">
            <ThemeButton />
            <Link className="hl-btn hl-btn-ghost hl-btn-sm" to="/demo">
              Try the demo
            </Link>
            <button type="button" className="hl-btn hl-btn-primary hl-btn-sm" onClick={connect}>
              Open your feed
            </button>
          </div>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="hl-footer">
        <div className="hl-wrap hl-footer-row">
          <span className="hl-footer-name">hyperfeed</span>
          <span className="hl-muted">Open source, MIT · Built on Calimero</span>
          <span className="hl-footer-links">
            <Link to="/docs">Docs</Link>
            <Link to="/demo">Demo</Link>
            <a href={GITHUB} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="https://calimero.network" target="_blank" rel="noreferrer">
              calimero.network
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
