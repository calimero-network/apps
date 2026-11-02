// The fleet's shared light-glass look; first, so the app's own CSS maps onto it.
import '@calimero-apps/glass/glass.css';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { CalimeroProvider } from './lib/useCalimero';
import { captureInvite } from './lib/inviteLink';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-up.
captureInvite();

// StrictMode in dev only: double-invoked effects help find missing cleanup and
// mislead when reading a request log.
const Wrapper = import.meta.env.DEV
  ? StrictMode
  : ({ children }: { children: ReactNode }) => <>{children}</>;

createRoot(root).render(
  <Wrapper>
    {/* mero-js `CalimeroClient` through @calimero-apps/connect: `merod local`
        under `vite`, the Calimero Cloud cluster in a production build. */}
    <CalimeroProvider>
      <App />
    </CalimeroProvider>
  </Wrapper>,
);
