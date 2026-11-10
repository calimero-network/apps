import { useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { nodeBasename } from "@calimero-apps/node-served";
import { useInstanceRelease } from "@calimero-apps/passkey";

import FeedPage from "./pages/FeedPage";
import PostPage from "./pages/PostPage";
import LandingPage from "./pages/landing/LandingPage";
import SpacesPage from "./pages/SpacesPage";
import ForumsPage from "./pages/ForumsPage";
import InvitationHost from "./components/InvitationHost";
import SignInModal from "./components/SignInModal";
import { ToastProvider } from "./contexts/ToastContext";
import { getContextId } from "./lib/session";
import { useStoredForum } from "./lib/storedForum";
import type { SessionDeps } from "./session";
import { SessionProvider, useMaybeSignedIn, useSessionApi } from "./sessionContext";

/** Signed in, signed out, or still connecting (restoring a stored session). */
function useAuth(): { isAuthenticated: boolean; isLoading: boolean } {
  const { api } = useSessionApi();
  return {
    isAuthenticated: api.session.status === "signed-in",
    isLoading: api.session.status === "connecting",
  };
}

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ["/", "/docs", "/preview"];

/**
 * Gate every contract-backed route. Two conditions, in order, because they
 * need different screens:
 *   not signed in  -> the landing page (sign in with a passkey)
 *   signed in, no forum -> the space picker (create or open one)
 *
 * `isLoading` returns null rather than redirecting, so restoring a stored
 * session does not flash the landing page at someone already signed in.
 */
function RequireForum({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const forum = useStoredForum();
  // A forum is an app instance, served the frontend of the release it runs.
  // It is remembered (`setActiveForum`) before the pages open it, so the
  // other release reopens it.
  const leaving = useInstanceRelease(useMaybeSignedIn()?.client, forum === "open" ? getContextId() : null);

  if (isLoading || leaving) return null;
  if (!isAuthenticated) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  // No forum chosen yet -> the space picker, which is where one is created or
  // opened. And the stored forum must be one this account still reaches: it is
  // remembered across reloads, so it can name a forum deleted or a space left.
  // `checking` renders nothing until the cluster has answered.
  if (forum === "checking") return null;
  if (forum === "none") return <Navigate to="/spaces" replace />;
  return <>{children}</>;
}

/** Signed in, but not yet inside a forum: the picker screens. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return null;
  if (!isAuthenticated) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** An authenticated visitor has no business on the marketing page: into the app. */
function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  // Into the remembered forum only once the cluster has confirmed it.
  const forum = useStoredForum();
  if (isLoading) return null;
  if (isAuthenticated) {
    if (forum === "checking") return null;
    return <Navigate to={forum === "open" ? "/f" : "/spaces"} replace />;
  }
  return <>{children}</>;
}

/** The landing page with the passkey sign-in as its connect action. */
function Landing() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [signingIn, setSigningIn] = useState(false);
  return (
    <>
      <LandingPage
        onConnect={() => setSigningIn(true)}
        isAuthenticated={isAuthenticated}
        onOpenApp={() => navigate("/spaces")}
      />
      <SignInModal open={signingIn} onClose={() => setSigningIn(false)} />
    </>
  );
}

function AppRoutes() {
  // ToastProvider sits ABOVE the router: a toast raised by an action that
  // navigates would unmount with its page. InvitationHost WRAPS the routes: an
  // invitation link can land on any route, and while one is pending its
  // screens stand in for the route (no redirect to drop it).
  return (
    <ToastProvider>
      <InvitationHost>
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
                    <Landing />
                  </RedirectIfAuthed>
                ) : (
                  <Landing />
                )
              }
            />
          ))}
          {/* The /login PAGE is gone — every app had one, every one looked
            different, and its whole content was a button the visitor had
            already pressed to get there. The path stays as a redirect so a
            bookmark lands on the front door instead of a blank route. */}
          <Route path="/login" element={<Navigate to="/" replace />} />
          {/* Spaces (organizations) hold forums (app instances). An invitation
            is an org invitation: invite someone to the space once and they can
            read every forum in it. */}
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
      </InvitationHost>
    </ToastProvider>
  );
}

export default function App({ deps }: { deps?: SessionDeps } = {}) {
  return (
    <SessionProvider deps={deps}>
      <BrowserRouter basename={nodeBasename(new URL(window.location.href), "/")}>
        <AppRoutes />
      </BrowserRouter>
    </SessionProvider>
  );
}
