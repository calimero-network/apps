// v9 app-side scaffold. Minimal routing + auth gate.
//
// Auth comes exclusively from @calimero-network/mero-react — no
// calimero-client layer (removed in Phase-10 follow-up; see PR notes).
// Mirrors the battleships pattern: one MeroProvider, useMero for
// auth state + logout, ConnectButton for the connect/logout UI.
//
// Routes:
//   /               → landing page
//   /login          → Authenticate (node-URL + SSO flow)
//   /app/*          → WorkspaceLayout (logged-in only)
//   *               → redirect to /

import React, { Suspense, lazy, useEffect, useRef } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';
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
  const { isAuthenticated } = useMero();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const App: React.FC = () => {
  const { isAuthenticated, logout } = useMero();
  const wasAuthenticatedRef = useRef(false);

  // Activity-based 1h idle timeout on top of JWT expiry. A user who's
  // been inactive past SESSION_TIMEOUT_MS gets logged out proactively
  // even if their JWT is still nominally valid.
  //
  // The ref tracks auth transitions so we can clear session-scoped
  // caches on ANY de-auth path, not just our own idle-timeout branch.
  // If MeroProvider invalidates the session (JWT server-side expiry,
  // user hitting the logout button), isAuthenticated flips true→false
  // without going through isSessionExpired() — and the identity cache
  // (scoped by namespace, not by user) would otherwise leak a
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

  return (
    <Suspense fallback={<div />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Authenticate />} />
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
