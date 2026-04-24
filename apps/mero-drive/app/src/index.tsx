import React, { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import {
  MeroProvider,
  AppMode,
  setApplicationId as setMeroApplicationId,
  setNodeUrl as setMeroNodeUrl,
  localStorageTokenStorage,
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

// Bootstrap SSO callback params BEFORE React mounts — MeroProvider reads
// localStorage at init, a useEffect would always be too late. Mirrors
// the battleships pattern but fills mero-react's own storage keys
// directly (this app is mero-react-only, no calimero-client bridge
// required).
(function bootstrapHashParams() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  const p = new URLSearchParams(hash);
  const nodeUrl = p.get('node_url');
  const accessToken = p.get('access_token');
  const refreshToken = p.get('refresh_token');
  const expiresIn = p.get('expires_in');
  if (nodeUrl) setMeroNodeUrl(nodeUrl.trim());
  if (accessToken && refreshToken) {
    void localStorageTokenStorage.set({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresIn
        ? Date.now() + parseInt(expiresIn, 10) * 1000
        : Date.now() + 60 * 60 * 1000,
    });
  }
  if (accessToken || refreshToken) {
    p.delete('access_token');
    p.delete('refresh_token');
    p.delete('expires_in');
    const remaining = p.toString();
    window.history.replaceState(
      null,
      '',
      remaining ? `#${remaining}` : window.location.pathname + window.location.search,
    );
  }
})();

// Seed the default application id into mero-react's store so the
// login modal / connectToNode flow can resolve the app by id rather
// than by package-name registry lookup (faster + works offline). URL
// param `?app-id=<id>` overrides.
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
