import { useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useSessionApi } from "./api/sessionContext";
import { pendingInvite } from "./api/teams";
import LandingPage from "./pages/landing/LandingPage";
import TeamsPage from "./pages/teams/TeamsPage";
import TeamCalendarsPage from "./pages/teams/TeamCalendarsPage";
import CalendarPage from "./pages/calendar";
import BookPage from "./pages/book/BookPage";
import { ToastProvider } from "./contexts/ToastContext";
import InvitationPrompt from "./components/common/invitation-prompt/InvitationPrompt";
import SignInModal from "./components/common/modals/sign-in-modal/SignInModal";

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ["/", "/docs", "/preview"];

/** The session while it connects; nothing to redirect on yet. */
function useConnecting(): boolean {
  return useSessionApi().api.session.status === "connecting";
}

/** Signed-in routes. Signed out, the front door (which offers the passkey sign-in). */
function RequireAuth({ children }: { children: ReactNode }) {
  const { api } = useSessionApi();
  if (api.session.status === "connecting") return null;
  if (api.session.status !== "signed-in") return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * The front door. A signed-in visitor goes on to their teams (resuming the
 * team and calendar open last, utils/lastVisit). Signed out, the landing
 * page's call to action opens the passkey sign-in; an invitation link opens it
 * at once, since joining is what the visitor came for.
 */
function FrontDoor({ bounce }: { bounce: boolean }) {
  const { api } = useSessionApi();
  const navigate = useNavigate();
  const [signingIn, setSigningIn] = useState(() => pendingInvite() !== null);
  const signedIn = api.session.status === "signed-in";
  if (useConnecting()) return null;
  if (bounce && signedIn) return <Navigate to="/teams" replace state={{ resume: true }} />;
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
