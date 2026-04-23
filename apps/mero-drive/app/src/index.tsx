import React, { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import {
  AppMode,
  CalimeroProvider,
  setAppEndpointKey,
  setAccessToken,
  setRefreshToken,
} from '@calimero-network/calimero-client';
import {
  MeroProvider,
  AppMode as MeroAppMode,
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

// Bootstrap Tauri/SSO hash params BEFORE React mounts — CalimeroProvider
// reads localStorage at init, a useEffect would always be too late.
(function bootstrapHashParams() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  const p = new URLSearchParams(hash);
  const nodeUrl = p.get('node_url');
  const accessToken = p.get('access_token');
  const refreshToken = p.get('refresh_token');
  if (nodeUrl) setAppEndpointKey(nodeUrl.trim());
  if (accessToken) setAccessToken(accessToken);
  if (refreshToken) setRefreshToken(refreshToken);
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

// Persist app-id from URL into localStorage so CalimeroProvider picks it up.
const CALIMERO_APP_ID_KEY = 'calimero-application-id';
const appIdFromUrl =
  new URLSearchParams(window.location.search).get('app-id')?.trim() ||
  new URLSearchParams(window.location.hash.slice(1)).get('app-id')?.trim() ||
  '';
if (appIdFromUrl && !localStorage.getItem(CALIMERO_APP_ID_KEY)) {
  localStorage.setItem(CALIMERO_APP_ID_KEY, appIdFromUrl);
}
if (!localStorage.getItem(CALIMERO_APP_ID_KEY)) {
  localStorage.setItem(CALIMERO_APP_ID_KEY, getApplicationId());
}

// Disable StrictMode in production to avoid double-rendering which can
// trigger 429s from CalimeroProvider's duplicate auth checks.
const AppWrapper = import.meta.env.DEV ? StrictMode : React.Fragment;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <AppWrapper>
    <BrowserRouter>
      <CalimeroProvider
        packageName="com.calimero.mero-drive-docs"
        registryUrl="https://apps.calimero.network"
        mode={AppMode.MultiContext}
      >
        {/* MeroProvider is required for useMero() and every
            mero-react hook (useCreateContext, useSubgroups, etc.).
            CalimeroProvider handles auth + app discovery; MeroProvider
            owns the MeroJs instance the generated RegistryClient /
            DocsClient need. */}
        <MeroProvider
          packageName="com.calimero.mero-drive-docs"
          registryUrl="https://apps.calimero.network"
          mode={MeroAppMode.MultiContext}
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
      </CalimeroProvider>
    </BrowserRouter>
  </AppWrapper>,
);
