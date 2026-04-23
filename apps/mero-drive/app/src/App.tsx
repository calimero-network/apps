// v9 app-side scaffold. Minimal routing + auth gate — the folder/docs
// UI will be rebuilt against the new generated clients + mero-react
// hooks in Phases 5-8 of the namespace-migration plan.
//
// For now:
//   /               → landing page
//   /login          → Authenticate (node-URL + SSO flow)
//   /app/*          → placeholder workspace page (logged-in only)
//   *               → redirect to /

import React, { Suspense, lazy, useEffect, useRef } from 'react';
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
import { clearIdentityCache } from '@/hooks/useSelfIdentity';
import { clearWorkspaceState } from '@/context/WorkspaceContext';

const LandingPage = lazy(() => import('./pages/landing'));
const Authenticate = lazy(() => import('./pages/login/Authenticate'));
const WorkspaceLayout = lazy(() =>
  import('./components/workspace/WorkspaceLayout').then((m) => ({
    default: m.WorkspaceLayout,
  })),
);

function AuthedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useCalimero();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const App: React.FC = () => {
  const { isAuthenticated, logout } = useCalimero();
  const wasAuthenticatedRef = useRef(false);

  // Activity-based 1h idle timeout on top of JWT expiry. Preserved from the
  // v8 App.tsx — a user who's been inactive past SESSION_TIMEOUT_MS gets
  // logged out proactively even if their JWT is still nominally valid.
  //
  // The ref tracks auth transitions so we can clear session-scoped caches
  // on ANY de-auth path, not just our own idle-timeout branch. If
  // CalimeroProvider invalidates the session (JWT server-side expiry, or a
  // future manual-logout UI), isAuthenticated flips true→false without
  // going through isSessionExpired() — and the identity cache, which is
  // scoped by namespace rather than authenticated user, would leak a
  // previous user's pubkey to the next user on the same browser.
  useEffect(() => {
    if (!isAuthenticated) {
      if (wasAuthenticatedRef.current) {
        clearStoredSession();
        clearSessionActivity();
        clearIdentityCache();
        clearWorkspaceState();
      }
      wasAuthenticatedRef.current = false;
      return;
    }
    wasAuthenticatedRef.current = true;
    if (isSessionExpired()) {
      clearStoredSession();
      clearSessionActivity();
      clearIdentityCache();
      clearWorkspaceState();
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
              <WorkspaceLayout />
            </AuthedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
};

export default App;
