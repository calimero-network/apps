// Root of the app. Mirrors battleships' App.tsx shape exactly: a
// single MeroProvider at the top, then the UI-level providers, then
// the router. No session-timeout logic here — the per-page guard in
// pages/workspace/index.tsx handles the "not authenticated" branch,
// and Phase 3's useDriveWorkspace owns any cache invalidation on
// namespace switch / logout.
//
// Env vars consumed:
//   VITE_PACKAGE_NAME    — passed to MeroProvider so the OAuth flow
//                          can resolve the application id from the
//                          public registry
//   VITE_REGISTRY_URL    — optional registry override (self-hosted)
//
// Routes:
//   /          → landing page (public)
//   /login     → Authenticate (ConnectButton entry)
//   /app/*     → WorkspacePage (auth-guarded shell, mounts
//                 WorkspaceLayout)
//   *          → redirect to /

import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppMode, MeroProvider } from '@calimero-network/mero-react';
import { ToastProvider } from '@calimero-network/mero-ui';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';

import LandingPage from './pages/landing';
import Authenticate from './pages/login/Authenticate';
import WorkspacePage from './pages/workspace';

export default function App() {
  const packageName = import.meta.env.VITE_PACKAGE_NAME?.trim() || undefined;
  const registryUrl = import.meta.env.VITE_REGISTRY_URL?.trim() || undefined;

  return (
    <MeroProvider
      mode={AppMode.MultiContext}
      packageName={packageName}
      registryUrl={registryUrl}
    >
      <ToastProvider>
        <TooltipProvider>
          <ConfirmProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<Authenticate />} />
                <Route path="/app/*" element={<WorkspacePage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </ConfirmProvider>
        </TooltipProvider>
      </ToastProvider>
    </MeroProvider>
  );
}
