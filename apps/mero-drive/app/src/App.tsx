import React, { Suspense, lazy, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { getAuthConfig, setAppEndpointKey, useCalimero } from '@calimero-network/calimero-client';
import {
  isSessionExpired,
  clearStoredSession,
  clearSessionActivity,
  updateSessionActivity,
} from '@/utils/session';
import { getNodeUrlFromUrl } from '@/constants/config';

// Lazy load pages for code splitting
const HomePage = lazy(() => import('./pages/home'));
const Authenticate = lazy(() => import('./pages/login/Authenticate'));
const EditorPage = lazy(() => import('./pages/editor'));
const FileDetailsPage = lazy(() => import('./pages/file-details'));
const JoinPage = lazy(() => import('./pages/join'));

const PageLoader = () => (
  <div className="flex items-center justify-center h-screen bg-background">
    <div className="text-center">
      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
      <p className="text-muted-foreground">Loading...</p>
    </div>
  </div>
);

export default function App() {
  const { isAuthenticated, logout } = useCalimero();
  const navigate = useNavigate();
  const location = useLocation();
  const hasStrippedRef = useRef(false);

  // Compute config state fresh on every render — reads directly from localStorage
  // so it's always accurate without needing a timer or stale state.
  const authConfig = getAuthConfig();
  const isConfigSet = Boolean(authConfig?.appEndpointKey && authConfig?.jwtToken);

  // Strip node_url query param once on mount and redirect to /
  useEffect(() => {
    if (hasStrippedRef.current) return;
    hasStrippedRef.current = true;

    const nodeUrl = getNodeUrlFromUrl();
    if (nodeUrl) {
      setAppEndpointKey(nodeUrl.trim());
      const url = new URL(window.location.href);
      url.searchParams.delete('node_url');
      url.searchParams.delete('node-url');
      const hashParams = new URLSearchParams(url.hash.slice(1));
      hashParams.delete('node_url');
      hashParams.delete('node-url');
      const remaining = hashParams.toString();
      url.hash = remaining ? `#${remaining}` : '';
      window.history.replaceState({}, '', url.toString());
      if (location.pathname !== '/') {
        navigate('/', { replace: true });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Check for expired session on every auth change
  useEffect(() => {
    if (isAuthenticated) {
      if (isSessionExpired()) {
        clearStoredSession();
        clearSessionActivity();
        logout();
      } else {
        updateSessionActivity();
      }
    }
  }, [isAuthenticated, logout]);

  // Route helper: keeps showing a spinner on protected routes while tokens exist
  // but CalimeroProvider hasn't finished its async auth check yet. Only redirects
  // to / when there are no tokens at all (isConfigSet = false).
  const protectedRoute = (element: React.ReactNode) => {
    if (!isConfigSet) return <Navigate to="/" replace />;
    if (!isAuthenticated) return <PageLoader />;
    return <>{element}</>;
  };

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route
          path="/"
          element={
            <Authenticate isAuthenticated={isAuthenticated} isConfigSet={isConfigSet} />
          }
        />
        <Route path="/home" element={protectedRoute(<HomePage />)} />
        <Route path="/editor" element={protectedRoute(<EditorPage />)} />
        <Route path="/editor/:documentId" element={protectedRoute(<EditorPage />)} />
        <Route path="/files/:fileId" element={protectedRoute(<FileDetailsPage />)} />
        <Route path="/join" element={<JoinPage />} />
      </Routes>
    </Suspense>
  );
}
