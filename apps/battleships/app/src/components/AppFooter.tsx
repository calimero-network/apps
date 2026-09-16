import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Resource footer for the in-app screens.
 *
 * The landing page has its own footer, but that one is a GENERATED file
 * (`src/pages/landing/*`, written by `pnpm landing:generate` and checked by
 * `pnpm landing:check`), so it cannot be imported or edited from here. These
 * links are the same set, restated rather than shared — the alternative was
 * editing the shared template, which would change all fourteen apps.
 */

const LINKS = {
  site: 'https://calimero.network',
  docs: 'https://docs.calimero.network',
  registry: 'https://apps.calimero.network',
  core: 'https://github.com/calimero-network/core',
  apps: 'https://github.com/calimero-network/apps',
  source: 'https://github.com/calimero-network/apps/tree/main/apps/battleships',
};

function Out({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="app-footer-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <span className="app-footer-ext" aria-hidden>↗</span>
    </a>
  );
}

export default function AppFooter() {
  return (
    <footer className="app-footer">
      <div className="app-footer-grid">
        <div className="app-footer-col">
          <h4 className="app-footer-head">Battleships</h4>
          {/* `state.fromApp` gets a signed-in visitor past the guard on `/`. */}
          <Link className="app-footer-link" to="/" state={{ fromApp: true }}>
            About this app
          </Link>
          <Link className="app-footer-link" to="/docs" state={{ fromApp: true }}>
            How it works
          </Link>
          <Out href={LINKS.source}>Source code</Out>
        </div>

        <div className="app-footer-col">
          <h4 className="app-footer-head">Calimero</h4>
          <Out href={LINKS.site}>calimero.network</Out>
          <Out href={LINKS.docs}>Platform docs</Out>
          <Out href={LINKS.registry}>App registry</Out>
        </div>

        <div className="app-footer-col">
          <h4 className="app-footer-head">Code</h4>
          <Out href={LINKS.apps}>Apps repository</Out>
          <Out href={LINKS.core}>Calimero core</Out>
        </div>
      </div>

      <div className="app-footer-base">
        <span>Built on Calimero. Your board never leaves your node.</span>
      </div>
    </footer>
  );
}
