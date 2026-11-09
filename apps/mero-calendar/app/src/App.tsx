import { useRef, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useSessionApi } from "./api/sessionContext";
import { deferInvite, inviteDeferred, joinedAtSignUpPending, pendingInvite } from "./api/teams";
import LandingPage from "./pages/landing/LandingPage";
import TeamsPage from "./pages/teams/TeamsPage";
import TeamCalendarsPage from "./pages/teams/TeamCalendarsPage";
import CalendarPage from "./pages/calendar";
import BookPage from "./pages/book/BookPage";
import { ToastProvider } from "./contexts/ToastContext";
import InvitationPrompt from "./components/common/invitation-prompt/InvitationPrompt";
import SignInModal from "./components/common/modals/sign-in-modal/SignInModal";
import InvitationPage from "./components/common/invitation-page/InvitationPage";

/** Where a signed-out visitor was going when the guard sent them to the front door. */
type FromState = { from?: string; resume?: boolean } | null;

/**
 * The front door's redirect state, one object: a new one each render re-runs
 * `<Navigate>`, which then wins over InvitationPrompt's move to the joined team.
 */
const RESUME = { resume: true };

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ["/", "/docs", "/preview"];

/** The session while it connects; nothing to redirect on yet. */
function useConnecting(): boolean {
  return useSessionApi().api.session.status === "connecting";
}

/** Signed-in routes. Signed out, the front door (which offers the passkey sign-in). */
function RequireAuth({ children }: { children: ReactNode }) {
  const { api } = useSessionApi();
  const location = useLocation();
  if (api.session.status === "connecting") return null;
  // The route travels with the redirect, so signing in on the front door goes
  // on to the page that was asked for rather than to the team list.
  if (api.session.status !== "signed-in") {
    return <Navigate to="/" replace state={{ from: `${location.pathname}${location.search}` } satisfies FromState} />;
  }
  return <>{children}</>;
}

/**
 * The front door. A signed-in visitor goes on to their teams (resuming the
 * team and calendar open last, utils/lastVisit), or to the page the route
 * guard sent them here from. Signed out, the landing page's call to action
 * opens the passkey sign-in.
 *
 * Signed out with an invitation waiting, the invitation IS the page: no hero
 * behind it, no popup, no extra click. "Not now" comes back to the ordinary
 * page, keeping the token for a later sign-in.
 */
function FrontDoor({ bounce }: { bounce: boolean }) {
  const { api } = useSessionApi();
  const navigate = useNavigate();
  const from = (useLocation().state as FromState)?.from;
  const [signingIn, setSigningIn] = useState(false);
  const [deferred, setDeferred] = useState(() => inviteDeferred());
  const signedIn = api.session.status === "signed-in";
  // Joined at sign-up: InvitationPrompt is opening what the link named. Held
  // until this page unmounts, so a later render cannot redirect first.
  const joining = useRef(false);
  if (joinedAtSignUpPending()) joining.current = true;
  if (useConnecting()) return null;
  if (bounce && signedIn && joining.current) return null;
  if (bounce && signedIn) {
    // With an invitation waiting, the page asked for comes AFTER joining
    // (InvitationPrompt goes there): opened before, it is not yours to read yet.
    return from && pendingInvite() === null ? (
      <Navigate to={from} replace />
    ) : (
      <Navigate to="/teams" replace state={RESUME} />
    );
  }
  if (!signedIn && !deferred && pendingInvite() !== null) {
    return (
      <InvitationPage
        onNotNow={() => {
          deferInvite();
          setDeferred(true);
        }}
      />
    );
  }
  return (
    <>
      <LandingPage
        onConnect={() => setSigningIn(true)}
        isAuthenticated={signedIn}
        onOpenApp={() => navigate("/teams")}
      />
      {signingIn && !signedIn && <SignInModal onClose={() => setSigningIn(false)} />}
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      {/* Above the routes: an invitation link can open this app on any page. */}
      <InvitationPrompt />
      <Routes>
        {LANDING_PATHS.map((landingPath) => (
          // Only `/` bounces a signed-in visitor into the app: `/docs` and
          // `/preview` are reference pages.
          <Route key={landingPath} path={landingPath} element={<FrontDoor bounce={landingPath === "/"} />} />
        ))}
        <Route path="/login" element={<Navigate to="/" replace />} />
        {/* A booking link's guest: no session, the link's API key is the whole
            credential. Outside RequireAuth on purpose. */}
        <Route path="/book" element={<BookPage />} />
        <Route
          path="/teams"
          element={
            <RequireAuth>
              <TeamsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/teams/:teamId"
          element={
            <RequireAuth>
              <TeamCalendarsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/teams/:teamId/calendar/:contextId"
          element={
            <RequireAuth>
              <CalendarPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
