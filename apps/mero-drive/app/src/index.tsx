import React, { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import {
  MeroProvider,
  AppMode,
  setApplicationId as setMeroApplicationId,
} from '@calimero-network/mero-react';
import { ToastProvider } from '@calimero-network/mero-ui';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { WorkspaceProvider } from '@/context/WorkspaceContext';
import { RegistryProvider } from '@/context/RegistryContext';
import { getApplicationId } from '@/constants/config';
import '@calimero-network/mero-ui/styles.css';
import './index.css';
import App from './App';

// Unregister any stale service workers from previous builds / sibling
// apps on the same origin so they stop intercepting requests.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}

// Seed the default application id into mero-react's store so the
// login modal / connectToNode flow can resolve the app by id rather
// than by package-name registry lookup (faster + works offline). URL
// param `?app-id=<id>` overrides.
//
// We do NOT touch the OAuth callback hash here — MeroProvider reads
// `window.location.href` in its own useRef init and calls
// `parseAuthCallback` to extract the tokens. Clearing the hash before
// React mounts (as an earlier version of this file did) silently
// swallows the callback: MeroProvider then sees no tokens and stays
// unauthenticated despite a successful OAuth round-trip.
(function bootstrapAppId() {
  const appIdFromUrl =
    new URLSearchParams(window.location.search).get('app-id')?.trim() ||
    new URLSearchParams(window.location.hash.slice(1)).get('app-id')?.trim() ||
    '';
  const effective = appIdFromUrl || getApplicationId();
  if (effective) setMeroApplicationId(effective);
})();

// Disable StrictMode in production to avoid double-rendering which
// can trigger duplicate auth init races in MeroProvider.
const AppWrapper = import.meta.env.DEV ? StrictMode : React.Fragment;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <AppWrapper>
    <BrowserRouter>
      <MeroProvider
        mode={AppMode.MultiContext}
        packageName="com.calimero.mero-drive-docs"
        registryUrl="https://apps.calimero.network"
      >
        <WorkspaceProvider>
          <RegistryProvider>
            <ToastProvider>
              <TooltipProvider>
                <ConfirmProvider>
                  <App />
                </ConfirmProvider>
              </TooltipProvider>
            </ToastProvider>
          </RegistryProvider>
        </WorkspaceProvider>
      </MeroProvider>
    </BrowserRouter>
  </AppWrapper>,
);
