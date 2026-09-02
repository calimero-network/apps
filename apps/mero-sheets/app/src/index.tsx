import React from 'react';
import ReactDOM from 'react-dom/client';
import '@calimero-network/mero-ui/styles.css';
import './index.css';
import App from './App';
import { THEME } from './config';
import { bootstrapSsoAndInvitation } from './auth/ssoBootstrap';
import { applyTheme, getStoredTheme } from './theme';

// Apply the saved light/dark theme before first paint (avoids a flash).
applyTheme(getStoredTheme());

// Desktop auth-skip + web invitation capture. MUST run before React mounts so
// MeroProvider reads an already-authenticated desktop session on first render
// (skipping the manual connect/accept steps when opened from the desktop app).
bootstrapSsoAndInvitation();

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
