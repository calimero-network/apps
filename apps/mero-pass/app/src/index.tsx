// The fleet's shared light-glass look, first, so the app's own tokens map onto it.
import '@calimero-apps/glass/glass.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import './index.css';
import App from './App';
import { CalimeroProvider } from './calimero';
import { basename } from './lib/basename';
import { invites, migrateLegacyInvite } from './lib/inviteLink';

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-up.
// An invite an earlier build stored under its own keys moves over first, so a
// fresh link wins.
migrateLegacyInvite();
invites.capture(window.location, { basename: basename() });

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);
root.render(
  <React.StrictMode>
    <CalimeroProvider>
      <BrowserRouter basename={basename()}>
        <App />
      </BrowserRouter>
    </CalimeroProvider>
  </React.StrictMode>,
);
