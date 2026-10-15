import '@calimero-apps/glass/glass.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@calimero-network/mero-ui/styles.css';
import './index.css';
import App from './App';
import { primeInvitationCapture } from '@calimero-network/mero-react';
import { APP_SLUG } from './utils/invitation';

// An invitation reaches this app only as an opened link: the links page (or a
// cold desktop start) appends `?invitation=…` to this URL, and a running
// desktop sends a `deep-link` event. Captured before the router can rewrite
// the URL; a link addressed to another app is dropped, not offered.
primeInvitationCapture('battleships', { slug: APP_SLUG });

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
