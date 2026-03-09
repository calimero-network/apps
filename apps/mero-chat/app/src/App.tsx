import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { getAuthConfig, setAppEndpointKey, useCalimero } from "@calimero-network/calimero-client";
import { useEffect, useState, lazy, Suspense, useRef } from "react";
import { LoadingSpinner } from "./components/LoadingSpinner";
import {
  isSessionExpired,
  clearStoredSession,
  clearDmContextId,
  clearSessionActivity,
  updateSessionActivity,
} from "./utils/session";
import { ToastProvider, useToast } from "./contexts/ToastContext";
import { ToastManager } from "./components/common/ToastManager";
import { extractInvitationFromUrl, saveInvitationToStorage } from "./utils/invitation";
import { StorageHelper } from "./utils/storage";
import { getNodeUrlFromUrl } from "./constants/config";

// Lazy load pages for better performance
const Login = lazy(() => import("./pages/Login"));
const Home = lazy(() => import("./pages/Home"));
const IdleTimeoutWrapper = lazy(
  () => import("./components/IdleTimeoutWrapper"),
);
// Toast display component
function ToastDisplay() {
  const { toasts, removeToast } = useToast();
  return <ToastManager toasts={toasts} onRemoveToast={removeToast} />;
}

function App() {
  const { isAuthenticated, logout } = useCalimero();
  const navigate = useNavigate();
  const location = useLocation();
  const [isConfigSet, setIsConfigSet] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    // Only check config once to avoid repeated auth checks
    if (hasInitializedRef.current) return;

    const timer = setTimeout(() => {
      // If node_url query param is present, set it and redirect to auth (login) page
      const nodeUrlFromQuery = getNodeUrlFromUrl();
      if (nodeUrlFromQuery) {
        setAppEndpointKey(nodeUrlFromQuery.trim());
        const url = new URL(window.location.href);
        url.searchParams.delete("node_url");
        url.searchParams.delete("node-url");
        window.history.replaceState({}, "", url.toString());
        if (location.pathname !== "/login") {
          navigate("/login", { replace: true });
        }
      }

      // Check for invitation in URL and save to localStorage
      const invitation = extractInvitationFromUrl();
      if (invitation) {
        saveInvitationToStorage(invitation);
        // Clean URL by removing invitation parameter
        const url = new URL(window.location.href);
        url.searchParams.delete("invitation");
        window.history.replaceState({}, "", url.toString());
      }

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
    <ToastProvider>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route
            path="/login"
            element={
              isAuthenticated && isConfigSet && StorageHelper.getItem("chat-username") ? (
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
              ) : isAuthenticated && isConfigSet && StorageHelper.getItem("chat-username") ? (
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
        <ToastDisplay />
      </Suspense>
    </ToastProvider>
  );
}

export default App;
