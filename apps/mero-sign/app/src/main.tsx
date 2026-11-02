// The fleet's shared light-glass look; first, so the app's own CSS maps onto it.
import '@calimero-apps/glass/glass.css';
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { captureInvite } from './lib/invites';

const AppWrapper = import.meta.env.DEV ? StrictMode : React.Fragment;

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-up.
captureInvite();

// The session (merod local in dev, the Calimero Cloud cluster in production,
// see `@calimero-apps/connect`) is set up by `SessionProvider` inside `App`.
createRoot(document.getElementById('root')!).render(
  <AppWrapper>
    <App />
  </AppWrapper>,
);
