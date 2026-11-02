// The fleet's shared light-glass look; first, so the app's own CSS maps onto it.
import '@calimero-apps/glass/glass.css';
import React, { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import '@calimero-network/mero-ui/styles.css';
import './index.css';
import App from './App';
import { captureInvite } from '@/hooks/useNamespaceInvitation';

// Unregister stale service workers from previous builds / sibling apps
// on the same origin so they stop intercepting requests.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-in.
// InvitationPrompt (App.tsx) asks before anything is redeemed.
captureInvite();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
