import '@calimero-apps/glass/glass.css';
import { StrictMode, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import '@calimero-network/mero-ui/styles.css';
import '@fontsource-variable/jetbrains-mono';
import './index.css';
import App from './App';
import { basename, invites, migrateStoredInvite } from './lobbies';
import { registerServiceWorker } from "@calimero-apps/install";

// Installable as an app (Chrome, Edge); not in dev and not on a node.
registerServiceWorker();

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-up. An invite an
// older build stored under its own key moves over.
invites.capture(window.location, { basename: basename() });
migrateStoredInvite(invites);

// StrictMode in dev only. Double-invoking effects is useful for catching
// missing cleanup and actively misleading when you are reading a call log.
const Wrapper = import.meta.env.DEV
  ? StrictMode
  : ({ children }: { children: ReactNode }) => <>{children}</>;

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

ReactDOM.createRoot(root).render(
  <Wrapper>
    <App />
  </Wrapper>,
);
