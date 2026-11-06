import { useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useSessionApi } from "./api/sessionContext";
import { pendingInvite } from "./api/teams";
import LandingPage from "./pages/landing/LandingPage";
import TeamsPage from "./pages/TeamsPage";
import ProjectsPage from "./pages/ProjectsPage";
import EditorPage from "./pages/EditorPage";
import InvitationPrompt from "./components/InvitationPrompt";
import SignInModal from "./components/SignInModal";
import InvitationPage from "./components/InvitationPage";
import { ToastProvider } from "./contexts/ToastContext";

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ["/", "/docs", "/preview"];

/** Signed-in routes. Signed out, the front door (which offers the passkey sign-in). */
function RequireAuth({ children }: { children: ReactNode }) {
  const { api } = useSessionApi();
  const location = useLocation();
  if (api.session.status === "connecting") return null;
  if (api.session.status !== "signed-in") {
    // Remember where they were going: signing in from the landing page then
    // lands on that route, not the teams list.
    return <Navigate to="/" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

/**
 * A signed-out visitor holding an invite (`?invite=`, taken into storage by
 * `main.tsx`) sees the invitation as a page instead of whatever the route
 * would render. The URL is left alone, so a deep link opens where it pointed
 * once they are signed in, and `InvitationPrompt` redeems the invite.
 */
function InvitationGate({ children }: { children: ReactNode }) {
  const { api } = useSessionApi();
  const [later, setLater] = useState(false);
  const status = api.session.status;
  if (status === "signed-in" || later || pendingInvite() === null) return <>{children}</>;
  // Still restoring a session: it may turn out signed in, so show neither yet.
  if (status === "connecting") return null;
  return <InvitationPage onNotNow={() => setLater(true)} />;
}

/**
 * The front door. A signed-in visitor goes on to their teams (resuming the
 * team and project open last, utils/lastVisit), or to the route the auth
 * guard bounced them from. Signed out, the landing page's call to action opens
 * the passkey sign-in (an invitation link lands on `InvitationGate` first).
 */
function FrontDoor({ bounce }: { bounce: boolean }) {
  const { api } = useSessionApi();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: unknown } | null)?.from;
  const [signingIn, setSigningIn] = useState(false);
  const signedIn = api.session.status === "signed-in";
  if (api.session.status === "connecting") return null;
  if (bounce && signedIn) {
    if (typeof from === "string" && from.startsWith("/teams/")) return <Navigate to={from} replace />;
    return <Navigate to="/teams" replace state={{ resume: true }} />;
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
      <InvitationGate>
        <Routes>
          {LANDING_PATHS.map((landingPath) => (
            // Only `/` bounces a signed-in visitor into the app: `/docs` and
            // `/preview` are reference pages.
            <Route key={landingPath} path={landingPath} element={<FrontDoor bounce={landingPath === "/"} />} />
          ))}
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/teams" element={<RequireAuth><TeamsPage /></RequireAuth>} />
          <Route path="/teams/:teamId/projects" element={<RequireAuth><ProjectsPage /></RequireAuth>} />
          <Route path="/teams/:teamId/projects/:projectId" element={<RequireAuth><EditorPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </InvitationGate>
    </ToastProvider>
  );
}
