// The fleet's shared light-glass look; first, so the app's own CSS maps onto it.
import '@calimero-apps/glass/glass.css';
import React, { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import '@calimero-network/mero-ui/styles.css';
import './index.css';
import App from './App';
import { primeInvitationCapture } from '@calimero-apps/invite';
import { PACKAGE_NAME } from './constants/config';

// Unregister stale service workers from previous builds / sibling apps
// on the same origin so they stop intercepting requests.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}

// Links minted before the deep-link era carried the payload as `invite=`. The
// capture reads `invitation=` only, so rename it in place before it looks.
try {
  const url = new URL(window.location.href);
  const legacy = url.searchParams.get('invite');
  if (legacy && !url.searchParams.has('invitation')) {
    url.searchParams.delete('invite');
    url.searchParams.set('invitation', legacy);
    window.history.replaceState(window.history.state, '', url.toString());
  }
} catch {
  /* no URL / history API - nothing to rename */
}

// An invitation reaches this app only as an opened link: the links page (or a
// cold desktop start) appends `?invitation=…` to this URL, and a running
// desktop sends a `deep-link` event. Captured before the router can rewrite
// the URL; a link addressed to another app is dropped, not offered.
// InvitationPrompt (App.tsx) asks before anything is joined.
primeInvitationCapture('mero-docs', { slug: PACKAGE_NAME });

async function main() {
  // `?node=<n>` points a dev window at one rig node; see scripts/local-rig.sh.
  if (import.meta.env.DEV) {
    const { applyDevNodeSelection } = await import('./components/dev/devNode');
    await applyDevNodeSelection();
  }
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void main();
