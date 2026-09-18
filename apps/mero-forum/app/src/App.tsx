import { type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";

import FeedPage from "./pages/FeedPage";
import PostPage from "./pages/PostPage";
import LandingPage from "./pages/landing/LandingPage";
import SpacesPage from "./pages/SpacesPage";
import ForumsPage from "./pages/ForumsPage";
import InvitationPrompt from "./components/InvitationPrompt";
import { ToastProvider } from "./contexts/ToastContext";
import { getContextId } from "./lib/session";

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ["/", "/docs", "/preview"];

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

  if (isLoading) return null;
  if (!isAuthenticated) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  // No forum chosen yet -> the space picker, which is where one is created or
  // joined. This used to be a `SetupPage` that could make exactly ONE forum,
  // because the app modelled "a namespace with one context inside it" and had
  // no way to express a second. Spaces and forums are separate screens now.
  if (!getContextId()) return <Navigate to="/spaces" replace />;
  return <>{children}</>;
}

/** Signed in, but not yet inside a forum: the picker screens. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  const location = useLocation();
  if (isLoading) return null;
  if (!isAuthenticated) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
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
  if (isAuthenticated)
    return <Navigate to={getContextId() ? "/f" : "/spaces"} replace />;
  return <>{children}</>;
}

export default function App() {
  // ToastProvider and InvitationPrompt sit ABOVE the router: a toast raised by
  // an action that navigates would unmount with its page, and an invitation
  // link can land on any route, so a prompt mounted on one page shows nothing
  // for the others.
  return (
    <ToastProvider>
      <InvitationPrompt />
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
              landingPath === "/" ? (
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
        {/* Spaces (namespaces) hold forums; a forum is a subgroup plus the
          context that IS the discussion. An invitation is a NAMESPACE
          invitation, so with one namespace per forum every invite was to a
          single thread — there was no "invite someone to the space once and
          they can read every forum in it". */}
        <Route
          path="/spaces"
          element={
            <RequireAuth>
              <SpacesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/spaces/:namespaceId"
          element={
            <RequireAuth>
              <ForumsPage />
            </RequireAuth>
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
    </ToastProvider>
  );
}
