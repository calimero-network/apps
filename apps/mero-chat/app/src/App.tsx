import { Routes, Route, Navigate } from "react-router-dom";
import { getAuthConfig, useCalimero } from "@calimero-network/calimero-client";
import { useEffect, useState, lazy, Suspense, useRef } from "react";
import { LoadingSpinner } from "./components/LoadingSpinner";
import { isSessionExpired, clearStoredSession, clearDmContextId, clearSessionActivity, updateSessionActivity } from "./utils/session";

// Lazy load pages for better performance
const Login = lazy(() => import("./pages/Login"));
const Home = lazy(() => import("./pages/Home"));
const IdleTimeoutWrapper = lazy(() => import("./components/IdleTimeoutWrapper"));
const PWAInstallPrompt = lazy(() => import("./components/PWAInstallPrompt"));

function App() {
  const { isAuthenticated, logout } = useCalimero();
  const [isConfigSet, setIsConfigSet] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    // Only check config once to avoid repeated auth checks
    if (hasInitializedRef.current) return;
    
    const timer = setTimeout(() => {
      // Get authConfig inside effect to avoid unnecessary re-renders
      const authConfig = getAuthConfig();
      const hasRequiredConfig =
        authConfig?.appEndpointKey &&
        authConfig?.contextId &&
        authConfig?.executorPublicKey &&
        authConfig?.jwtToken;

      setIsConfigSet(Boolean(hasRequiredConfig));
      setIsLoading(false);
      hasInitializedRef.current = true;
    }, 100);

    return () => clearTimeout(timer);
  }, []); // Empty deps - only run once on mount

  // Check for expired session on app initialization and initialize session activity
  useEffect(() => {
    if (isAuthenticated) {
      if (isSessionExpired()) {
        // Session has expired, clear everything and logout
        clearStoredSession();
        clearDmContextId();
        clearSessionActivity();
        logout();
      } else {
        // User is authenticated and session is valid, initialize session activity
        updateSessionActivity();
      }
    }
  }, [isAuthenticated, logout]);

  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route
          path="/login"
          element={
            isAuthenticated && isConfigSet ? (
              <Navigate to="/" replace />
            ) : (
              <Login
                isAuthenticated={isAuthenticated}
                isConfigSet={isConfigSet}
              />
            )
          }
        />
        <Route
          path="/"
          element={
            isLoading ? (
              <LoadingSpinner />
            ) : isAuthenticated && isConfigSet ? (
              <IdleTimeoutWrapper>
                <Home isConfigSet={isConfigSet} />
              </IdleTimeoutWrapper>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      <PWAInstallPrompt />
    </Suspense>
  );
}

export default App;
