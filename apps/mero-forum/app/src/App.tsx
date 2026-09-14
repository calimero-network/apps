import { type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";

import FeedPage from "./pages/FeedPage";
import PostPage from "./pages/PostPage";
import LandingPage from "./pages/landing/LandingPage";
import SetupPage from "./pages/SetupPage";
import { useForumWorkspace } from "./lib/workspace";

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ['/', '/docs', '/preview'];


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
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  if (ws.loading) return null;
  if (ws.needsSetup) return <SetupPage ws={ws} />;
  return <>{children}</>;
}

/**
 * An authenticated visitor has no business on the marketing page.
 *
 * ⚠️ THIS IS THE STEP THAT CARRIES YOU INTO THE APP. The SSO callback returns
 * to wherever login started — `connectToNode` uses `window.location.href` as
 * the callback URL — which for a visitor who pressed Connect on the landing
 * page is `/`. Without this guard the tokens land, `isAuthenticated` flips
 * true, and the router renders the landing page again: you log in successfully
 * and end up exactly where you started.
 *
 * The app used to get this from a `RedirectIfAuthed` wrapped around its
 * `/login` route. Deleting that page took the redirect with it; the landing
 * routes need the same guard, because they are now where login begins and ends.
 */
function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  if (isLoading) return null; // the auth probe is still in flight
  if (isAuthenticated) return <Navigate to="/f" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* The explainer is the front door now, not the feed. */}
      {/* The landing page is three pages: `/`, `/docs` and `/preview`. They are
          real URLs so they can be shared and opened cold, which needs a route
          here — otherwise this app's catch-all swallows the deep link before
          the page ever renders. */}
      {LANDING_PATHS.map((landingPath) => (
        <Route
          key={landingPath}
          path={landingPath}
          // ⚠️ Only `/` bounces a signed-in visitor into the app. `/docs` and
          // `/preview` are reference pages, and somebody already signed in is
          // exactly the person most likely to want to read them.
          element={
            landingPath === '/' ? (
              <RedirectIfAuthed>
                <LandingPage />
              </RedirectIfAuthed>
            ) : (
              <LandingPage />
            )
          }
        />
      ))}
      {/* The /login PAGE is gone — every app had one, every one looked
          different, and its whole content was a button the visitor had
          already pressed to get there. The path stays as a redirect so a
          bookmark lands on the front door instead of a blank route. */}
      <Route path="/login" element={<Navigate to="/" replace />} />
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
