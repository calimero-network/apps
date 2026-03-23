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
import { ToastProvider } from '@calimero-network/mero-ui';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkspaceProvider } from '@/context/WorkspaceContext';
import { getApplicationId } from '@/constants/config';
import '@calimero-network/mero-ui/styles.css';
import './index.css';
import App from './App';

// Unregister any stale service workers left by previous builds or other
// Calimero apps on this origin so they stop intercepting and caching requests.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}

// Pre-process Tauri SSO hash params BEFORE React mounts.
// CalimeroProvider reads localStorage on init — tokens must be stored
// before the first render, not in a useEffect which is always too late.
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
  // Strip auth tokens from URL so they don't linger in address bar or history.
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

// Persist app-id from URL into localStorage so CalimeroProvider can find it.
const CALIMERO_APP_ID_KEY = 'calimero-application-id';
const appIdFromUrl =
  new URLSearchParams(window.location.search).get('app-id')?.trim() ||
  new URLSearchParams(window.location.hash.slice(1)).get('app-id')?.trim() ||
  '';
if (appIdFromUrl && !localStorage.getItem(CALIMERO_APP_ID_KEY)) {
  localStorage.setItem(CALIMERO_APP_ID_KEY, appIdFromUrl);
}
// CalimeroProvider only builds `app` when `resolvedApplicationId` is set (localStorage or OAuth hash).
// Admin API can still list workspaces without it — bootstrap so AbiClient/blob flows match WorkspaceManager.
if (!localStorage.getItem(CALIMERO_APP_ID_KEY)) {
  localStorage.setItem(CALIMERO_APP_ID_KEY, getApplicationId());
}

// Disable StrictMode in production to avoid double-rendering which can cause
// 429 errors from CalimeroProvider's double auth checks.
const AppWrapper = import.meta.env.DEV ? StrictMode : React.Fragment;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <AppWrapper>
    <BrowserRouter>
      <CalimeroProvider
        packageName="com.calimero.mero-drive"
        registryUrl="https://apps.calimero.network"
        mode={AppMode.MultiContext}
      >
        <WorkspaceProvider>
          <ToastProvider>
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </ToastProvider>
        </WorkspaceProvider>
      </CalimeroProvider>
    </BrowserRouter>
  </AppWrapper>,
);
