import { Routes, Route, Navigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { useEffect, useState, lazy, Suspense } from "react";
import { LoadingSpinner } from "./components/LoadingSpinner";
import {
  isSessionExpired,
  updateSessionActivity,
  isNamespaceReady,
} from "./utils/session";
import { ToastProvider, useToast } from "./contexts/ToastContext";
import { ToastManager } from "./components/common/ToastManager";

const Login = lazy(() => import("./pages/Login"));
const Home = lazy(() => import("./pages/Home"));
const IdleTimeoutWrapper = lazy(() => import("./components/IdleTimeoutWrapper"));

function ToastDisplay() {
  const { toasts, removeToast } = useToast();
  return <ToastManager toasts={toasts} onRemoveToast={removeToast} />;
}

function App() {
  const { isAuthenticated, isLoading, logout } = useMero();
  const [providerTimedOut, setProviderTimedOut] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setProviderTimedOut(false);
      return;
    }
    const id = setTimeout(() => setProviderTimedOut(true), 8000);
    return () => clearTimeout(id);
  }, [isLoading]);

  // Session expiry check and activity tracking
  useEffect(() => {
    if (isAuthenticated) {
      if (isSessionExpired()) {
        sessionStorage.clear();
        logout();
      } else {
        updateSessionActivity();
      }
    }
  }, [isAuthenticated, logout]);

  // canEnterApp requires both a valid auth session AND explicit namespace selection
  // in this browser session (sessionStorage flag). This prevents the app from
  // jumping straight to Home after a fresh login using stale localStorage values.
  const canEnterApp = isAuthenticated && isNamespaceReady();

  if (isLoading && !providerTimedOut) {
    return <LoadingSpinner />;
  }

  return (
    <ToastProvider>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route
            path="/login"
            element={
              canEnterApp ? (
                <Navigate to="/" replace />
              ) : (
                <Login
                  isAuthenticated={isAuthenticated}
                  isConfigSet={isAuthenticated}
                />
              )
            }
          />
          <Route
            path="/"
            element={
              canEnterApp ? (
                <IdleTimeoutWrapper>
                  <Home isConfigSet={isAuthenticated} />
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
