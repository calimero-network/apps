// The fleet's shared light-glass look; first, so the app's own CSS maps onto it.
import '@calimero-apps/glass/glass.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@calimero-network/mero-ui/styles.css';
import './index.css';
import App from './App';
import { THEME } from './config';
import { captureInvite } from './workspaces';
import { applyTheme, readStoredTheme } from './theme';

// index.html already put the saved theme on <html> before the first paint;
// this re-applies it in case that inline script could not run.
applyTheme(readStoredTheme());

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-up.
captureInvite();

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
