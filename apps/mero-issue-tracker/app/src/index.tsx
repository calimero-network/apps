// The fleet's shared light-glass look. First, so this app's own stylesheet
// (index.css maps its tokens onto these) overrides it, never the reverse.
import '@calimero-apps/glass/glass.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@calimero-network/mero-ui/styles.css';
import './index.css';
import App from './App';
import { THEME } from './config';
import { nodeBasename } from '@calimero-apps/node-served';
import { invites, migrateLegacyInvite } from './workspaces';
import { applyTheme, readStoredTheme } from './theme';
import { registerServiceWorker } from "@calimero-apps/install";

// Installable as an app (Chrome, Edge); not in dev and not on a node.
registerServiceWorker();

// index.html already put the saved theme on <html> before the first paint;
// this re-applies it in case that inline script could not run.
applyTheme(readStoredTheme());

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-up.
// An invite an earlier build stored under its own keys moves over first, so a
// fresh link wins.
migrateLegacyInvite();
invites.capture(window.location, { basename: nodeBasename(new URL(window.location.href), '/') });

// Inject theme tokens as CSS vars so components can read them via
// `var(--color-primary)` / `var(--color-accent)` regardless of selector scope.
{
  const root = document.documentElement;
  root.style.setProperty('--color-primary', THEME.primaryColor);
  root.style.setProperty('--color-accent', THEME.accentColor);
  root.dataset.style = THEME.style;
}

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
