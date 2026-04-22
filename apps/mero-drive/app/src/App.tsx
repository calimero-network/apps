// v9 app-side scaffold. Minimal routing + auth gate — the folder/docs
// UI will be rebuilt against the new generated clients + mero-react
// hooks in Phases 5-8 of the namespace-migration plan.
//
// For now:
//   /               → landing page
//   /login          → Authenticate (node-URL + SSO flow)
//   /app/*          → placeholder workspace page (logged-in only)
//   *               → redirect to /

import React, { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import {
  useCalimero,
  getAppEndpointKey,
  getAccessToken,
} from '@calimero-network/calimero-client';
import {
  isSessionExpired,
  clearStoredSession,
  clearSessionActivity,
  updateSessionActivity,
} from '@/utils/session';

const LandingPage = lazy(() => import('./pages/landing'));
const Authenticate = lazy(() => import('./pages/login/Authenticate'));

function WorkspacePlaceholder() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="max-w-md text-center space-y-4 p-8">
        <h1 className="text-2xl font-semibold">Mero Drive v9</h1>
        <p className="text-sm text-muted-foreground">
          You're authenticated against the v9 namespace backend. The
          folder + document UI is being rebuilt against the new
          registry / docs services and will land in follow-up PRs.
        </p>
      </div>
    </div>
  );
}

function AuthedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useCalimero();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const App: React.FC = () => {
  const { isAuthenticated, logout } = useCalimero();

  // Activity-based 1h idle timeout on top of JWT expiry. Preserved from the
  // v8 App.tsx — a user who's been inactive past SESSION_TIMEOUT_MS gets
  // logged out proactively even if their JWT is still nominally valid.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (isSessionExpired()) {
      clearStoredSession();
      clearSessionActivity();
      logout();
    } else {
      updateSessionActivity();
    }
  }, [isAuthenticated, logout]);

  // `isConfigSet` must mean "the user has supplied node URL AND token."
  // The Authenticate page's three-state machine (landing CTA / node-URL
  // form / authed redirect) relies on this exact semantic — widening it
  // to "CalimeroProvider has resolved an app" makes the node-URL form
  // unreachable because `app` can resolve at bootstrap before auth
  // completes.
  const isConfigSet = Boolean(getAppEndpointKey() && getAccessToken());

  return (
    <Suspense fallback={<div />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/login"
          element={
            <Authenticate isAuthenticated={isAuthenticated} isConfigSet={isConfigSet} />
          }
        />
        <Route
          path="/app/*"
          element={
            <AuthedRoute>
              <WorkspacePlaceholder />
            </AuthedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
};

export default App;
