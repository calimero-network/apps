// The fleet's shared light-glass look. First, so this app's own stylesheet
// (index.css maps its tokens onto these) overrides it, never the reverse.
import '@calimero-apps/glass/glass.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@calimero-network/mero-ui/styles.css';
import './index.css';
import App from './App';
import { THEME } from './config';
import { bootstrapSsoAndInvitation } from './auth/ssoBootstrap';
import { applyTheme, readStoredTheme } from './theme';

// index.html already put the saved theme on <html> before the first paint;
// this re-applies it in case that inline script could not run.
applyTheme(readStoredTheme());

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
