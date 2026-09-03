import { type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";

import FeedPage from "./pages/FeedPage";
import PostPage from "./pages/PostPage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import SetupPage from "./pages/SetupPage";
import { useForumWorkspace } from "./lib/workspace";

/**
 * Gate every contract-backed route.
 *
 * ⚠️ This is the fix for the reported `FunctionCallError`. The feed used to be
 * the app's `/` route and rendered unauthenticated: `useForumClient()` returned
 * null, every read failed, and the composer's only possible outcome was a
 * throw. Nothing on the page explained it or offered a way out.
 *
 * Two conditions, in order, because they need different screens:
 *   not authenticated  -> /login  (connect a node)
 *   authenticated, no forum -> the setup screen (create or join one)
 *
 * `isLoading` returns null rather than redirecting, so the auth probe does not
 * flash the login screen at someone who is already signed in.
 */
function RequireForum({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  const location = useLocation();
  const ws = useForumWorkspace();

  if (isLoading) return null;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (ws.loading) return null;
  if (ws.needsSetup) return <SetupPage ws={ws} />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/f" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* The explainer is the front door now, not the feed. */}
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/f"
        element={
          <RequireForum>
            <div className="shell">
              <FeedPage />
            </div>
          </RequireForum>
        }
      />
      <Route
        path="/p/:postId"
        element={
          <RequireForum>
            <div className="shell">
              <PostPage />
            </div>
          </RequireForum>
        }
      />
      {/* A stale shared link lands on the explainer rather than a blank page. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
