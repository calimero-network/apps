import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import LandingPage from "./pages/landing/LandingPage";
import CompaniesPage from "./pages/CompaniesPage";
import AudiencesPage from "./pages/AudiencesPage";
import AudienceShell from "./components/AudienceShell";
import UpdatesPage from "./pages/UpdatesPage";
import PostPage from "./pages/PostPage";
import ComposePage from "./pages/ComposePage";
import QuestionsPage from "./pages/QuestionsPage";
import AsksPage from "./pages/AsksPage";
import MetricsPage from "./pages/MetricsPage";
import PeoplePage from "./pages/PeoplePage";
import SettingsPage from "./pages/SettingsPage";
import InvitationPage from "./components/InvitationPage";
import InvitationPrompt from "./components/InvitationPrompt";
import SignInDialog from "./components/SignInDialog";
import { pendingInvite } from "./lib/companies";
import { useSessionApi } from "./lib/sessionContext";
import { ToastProvider } from "./contexts/ToastContext";
import { useStoredAudience } from "./lib/storedAudience";

/**
 * The session as the guards read it: still connecting (render nothing, so a
 * stored session does not flash the landing page), signed in, or not.
 */
function useAuth(): { isAuthenticated: boolean; isLoading: boolean } {
  const { session } = useSessionApi().api;
  return {
    isAuthenticated: session.status === "signed-in",
    isLoading: session.status === "connecting",
  };
}

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ["/", "/docs", "/preview"];

/**
 * Gate every contract-backed route.
 *
 * ⚠️ This is the fix for the reported `FunctionCallError`. The feed used to be
 * the app's `/` route and rendered unauthenticated: `useAudienceClient()` returned
 * null, every read failed, and the composer's only possible outcome was a
 * throw. Nothing on the page explained it or offered a way out.
 *
 * Two conditions, in order, because they need different screens:
 *   not signed in  -> /  (the landing page, whose connect action signs in)
 *   authenticated, no audience -> the setup screen (create or join one)
 *
 * `isLoading` returns null rather than redirecting, so the auth probe does not
 * flash the login screen at someone who is already signed in.
 */
function RequireAudience({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const audience = useStoredAudience();

  if (isLoading) return null;
  if (!isAuthenticated) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  // No audience chosen yet -> the space picker, which is where one is created or
  // joined. This used to be a `SetupPage` that could make exactly ONE audience,
  // because the app modelled "a namespace with one context inside it" and had
  // no way to express a second. Spaces and audiences are separate screens now.
  //
  // And the stored audience must be one this account can reach: it is
  // remembered across reloads and sign-ins, so it can name an instance deleted
  // or left. `checking` renders nothing until the node has answered.
  if (audience === "checking") return null;
  if (audience === "none") return <Navigate to="/companies" replace />;
  return <>{children}</>;
}

/** Signed in, but not yet inside an audience: the picker screens. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
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
 * ⚠️ THIS IS THE STEP THAT CARRIES YOU INTO THE APP. Signing in happens in a
 * dialog over the landing page at `/`; without this guard the session lands,
 * `isAuthenticated` flips true, and the router renders the landing page again.
 */
function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  // Into the remembered audience only once the node has confirmed it is reachable.
  const audience = useStoredAudience();
  if (isLoading) return null; // the auth probe is still in flight
  if (isAuthenticated) {
    if (audience === "checking") return null;
    return <Navigate to={audience === "open" ? "/a" : "/companies"} replace />;
  }
  return <>{children}</>;
}

/**
 * The landing page with its sign-in action: the passkey sign-in dialog. An
 * invitation link opened by someone signed out shows `InvitationPage` instead
 * (see `InvitationGate`), not this page.
 */
function Landing() {
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (isAuthenticated) setOpen(false);
  }, [isAuthenticated]);
  return (
    <>
      <LandingPage onConnect={() => setOpen(true)} />
      <SignInDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * A signed-out visitor who opened an invitation link sees the invitation as a
 * page, in place of whatever route the link named: no landing hero behind it
 * and no extra click to find the sign-in. Nothing navigates, so the address
 * (under the `/<version>/` basename) is still the deep link once they are
 * signed in, and the route guards never get the chance to bounce it to `/`.
 * "Not now" falls through to the routes and keeps the token.
 */
function InvitationGate({ children }: { children: ReactNode }) {
  const { session } = useSessionApi().api;
  const [notNow, setNotNow] = useState(false);
  if (session.status === "signed-out" && !notNow && pendingInvite()) {
    return <InvitationPage onNotNow={() => setNotNow(true)} />;
  }
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
      <InvitationGate>
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
          {/* Companies (organizations) hold audiences (app instances). An
            invitation is to the company, so someone invited once can read every
            audience in it. */}
          <Route
            path="/companies"
            element={
              <RequireAuth>
                <CompaniesPage />
              </RequireAuth>
            }
          />
          <Route
            path="/companies/:namespaceId"
            element={
              <RequireAuth>
                <AudiencesPage />
              </RequireAuth>
            }
          />
          {/* Inside one audience. The shell owns the header, the nav and the
            live-refresh subscription; each section is a child route so a link
            to one update (/a/p/:id) is shareable within the audience. */}
          <Route
            path="/a"
            element={
              <RequireAudience>
                <AudienceShell />
              </RequireAudience>
            }
          >
            <Route index element={<UpdatesPage />} />
            <Route path="p/:postId" element={<PostPage />} />
            <Route path="compose" element={<ComposePage />} />
            <Route path="questions" element={<QuestionsPage />} />
            <Route path="asks" element={<AsksPage />} />
            <Route path="metrics" element={<MetricsPage />} />
            <Route path="people" element={<PeoplePage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          {/* The pre-rename paths, so an old bookmark lands somewhere real. */}
          <Route path="/spaces" element={<Navigate to="/companies" replace />} />
          {/* A stale shared link lands on the explainer rather than a blank page. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </InvitationGate>
    </ToastProvider>
  );
}
