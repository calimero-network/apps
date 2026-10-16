import { Routes, Route, Navigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { useEffect, useState, lazy, Suspense } from "react";
import { LoadingSpinner } from "./components/LoadingSpinner";
import { isNamespaceReady } from "./utils/session";
import { hasLiveSession } from "./utils/authTokens";
import { ToastProvider, useToast } from "./contexts/ToastContext";
import { ToastManager } from "./components/common/ToastManager";
import InvitationPrompt from "./components/popups/InvitationPrompt";

const Login = lazy(() => import("./pages/Login"));
// `/docs` and `/preview` are the shared landing template's other two pages.
// Real URLs, so they can be shared and opened cold — and reachable signed in
// too, since someone already using the app is who most wants the docs.
const Landing = lazy(() =>
  import("./pages/Login").then((m) => ({ default: m.UnauthenticatedLanding })),
);
const Home = lazy(() => import("./pages/Home"));

function ToastDisplay() {
  const { toasts, removeToast } = useToast();
  return <ToastManager toasts={toasts} onRemoveToast={removeToast} />;
}

function App() {
  const { isAuthenticated, isLoading } = useMero();
  const [providerTimedOut, setProviderTimedOut] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setProviderTimedOut(false);
      return;
    }
    const id = setTimeout(() => setProviderTimedOut(true), 8000);
    return () => clearTimeout(id);
  }, [isLoading]);

  // A session ends when the user ends it. There is deliberately no inactivity
  // expiry here: this is a chat app, and being idle — or leaving the tab open in
  // the background overnight — is normal use, not a reason to destroy someone's
  // session. Staying signed in costs nothing extra in exposure either, since the
  // refresh token sits in the same localStorage the access token already does.
  // Token lifetime is handled underneath us: core's access tokens last an hour,
  // and mero-js silently refreshes them on the first 401.

  // canEnterApp requires both a valid auth session AND a workspace the user
  // entered (`isNamespaceReady`: the id last entered, still the current group).
  // It survives reloads so a returning user lands back in their workspace, but
  // logout and a fresh Connect clear it, so a fresh login still picks one
  // rather than jumping straight to Home on stale localStorage values.
  //
  // `isAuthenticated` is reactive from mero-react but lags `false` for a beat
  // right after a fresh connect (its `/auth/validate` can cold-start 503). The
  // client-side navigate that workspace entry does would then bounce back to the
  // picker (fixed only by a manual reload). Treat a stored, non-expired token as
  // a valid session so entry doesn't flap — namespace selection is still required.
  const canEnterApp =
    (isAuthenticated || hasLiveSession()) && isNamespaceReady();

  const loading = isLoading && !providerTimedOut;

  return (
    <ToastProvider>
      {/* Above the routes, and mounted through loading too, so an opened
          invitation link is offered on whatever page the user is on — the
          workspace picker after login, or inside a workspace — and the prompt
          is never torn down mid-join. It waits until the session can join. */}
      <InvitationPrompt
        enabled={!loading && (isAuthenticated || hasLiveSession())}
      />
      {loading ? (
        <LoadingSpinner />
      ) : (
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
                  <Home isConfigSet={isAuthenticated} />
                ) : (
                  <Navigate to="/login" replace />
                )
              }
            />
            <Route path="/docs" element={<Landing />} />
            <Route path="/preview" element={<Landing />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
          <ToastDisplay />
        </Suspense>
      )}
    </ToastProvider>
  );
}

export default App;
