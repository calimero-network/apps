import React, { type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppMode, MeroProvider, useMero } from '@calimero-network/mero-react';
import { ToastProvider } from '@calimero-network/mero-ui';

import LandingPage from './pages/landing/LandingPage';
import LoginPage from './pages/login/LoginPage';
import AppPage from './pages/app/AppPage';
import { APP_PACKAGE, APP_ROUTE } from './config';

/**
 * Auth route guards. The MeroProvider resolves auth ASYNCHRONOUSLY — on first
 * render `isAuthenticated` is `false` while `isLoading` is `true` until the
 * `getContexts()` probe (and any login-callback / desktop-SSO token) resolves.
 *
 * Both guards MUST wait for `isLoading` to settle before redirecting; otherwise
 * a freshly-authenticated user (or a refresh on a protected route) is bounced
 * away before the probe finishes — the exact "logged in but kicked back to the
 * landing page" bug. Mirrors mero-design's RequireAuth / RedirectIfAuthed.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  if (isLoading) return null; // wait for the auth probe; avoids a flash-bounce
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to={APP_ROUTE} replace />;
  return <>{children}</>;
}

export default function App() {
  const registryUrl = import.meta.env.VITE_REGISTRY_URL?.trim() || undefined;
  // P4 RUNTIME defense against package shadowing: APP_PACKAGE (from
  // studio.config via ./config) takes precedence over a stale
  // VITE_PACKAGE_NAME left in app/.env. The canonical strip lives in
  // configTools.propagateSpecToConfig; this precedence flip survives any
  // out-of-band .env write at any time — keep BOTH.
  const packageName =
    APP_PACKAGE || import.meta.env.VITE_PACKAGE_NAME?.trim();

  return (
    <MeroProvider
      mode={AppMode.MultiContext}
      packageName={packageName}
      registryUrl={registryUrl}
    >
      <ToastProvider>
        <BrowserRouter basename="/">
          <Routes>
            {/* Landing is the front door; authenticated users (incl. desktop
                SSO skip) are redirected straight into the app. */}
            <Route path="/" element={<RedirectIfAuthed><LandingPage /></RedirectIfAuthed>} />
            <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
            <Route path={APP_ROUTE} element={<RequireAuth><AppPage /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </MeroProvider>
  );
}
