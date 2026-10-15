// The fleet's shared light-glass look. First, so this app's own stylesheet
// (index.css maps its tokens onto these) overrides it, never the reverse.
import '@calimero-apps/glass/glass.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@calimero-network/mero-ui/styles.css';
import './index.css';
import App from './App';
import { THEME } from './config';
import { primeInvitationCapture } from '@calimero-apps/invite';
import { bootstrapSso } from './auth/ssoBootstrap';
import { APP_SLUG } from './lib/inviteLink';
import { applyTheme, getStoredTheme } from './theme';

// Apply the saved light/dark theme before first paint (avoids a flash).
applyTheme(getStoredTheme());

// Desktop auth-skip. MUST run before React mounts so MeroProvider reads an
// already-authenticated desktop session on first render (skipping the manual
// connect step when opened from the desktop app).
bootstrapSso();

// An invitation reaches this app only as an opened link: the links page (or a
// cold desktop start) appends `?invitation=…` to this URL, and a running
// desktop sends a `deep-link` event. Captured before the router redirects `/`
// away and before a signed-out visitor goes to log in; a link addressed to
// another app is dropped, not offered. `InvitationPrompt` asks before joining.
primeInvitationCapture('mero-sheets', { slug: APP_SLUG });

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
