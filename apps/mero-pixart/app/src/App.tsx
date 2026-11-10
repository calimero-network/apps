import { useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import { useInstanceRelease } from "@calimero-apps/passkey";
import { useSessionApi } from "./api/sessionContext";
import LandingPage from "./pages/landing/LandingPage";
import TeamsPage from "./pages/TeamsPage";
import ProjectsPage from "./pages/ProjectsPage";
import EditorPage from "./pages/EditorPage";
import InvitationHost from "./components/InvitationHost";
import SignInModal from "./components/SignInModal";
import { ToastProvider } from "./contexts/ToastContext";

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ["/", "/docs", "/preview"];

/** Signed-in routes. Signed out, the front door (which offers the passkey sign-in). */
function RequireAuth({ children }: { children: ReactNode }) {
  const { api } = useSessionApi();
  if (api.session.status === "connecting") return null;
  if (api.session.status !== "signed-in") return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * A project is an app instance, served the frontend of the release it runs.
 * The route names it, so the other release opens the same project; nothing of
 * it renders while the page is leaving.
 */
function ProjectRoute() {
  const { projectId } = useParams();
  const { api } = useSessionApi();
  const leaving = useInstanceRelease(api.session.status === "signed-in" ? api.session.client : null, projectId);
  if (leaving) return null;
  return <EditorPage />;
}

/**
 * The front door. A signed-in visitor goes on to their teams (resuming the
 * team and project open last, utils/lastVisit). Signed out, the landing page's
 * call to action opens the passkey sign-in. (An invitation link lands on the
 * invitation page first: `InvitationHost`.)
 */
function FrontDoor({ bounce }: { bounce: boolean }) {
  const { api } = useSessionApi();
  const navigate = useNavigate();
  const [signingIn, setSigningIn] = useState(false);
  const signedIn = api.session.status === "signed-in";
  if (api.session.status === "connecting") return null;
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
      {/* Around the routes: an invitation link can open this app on any page,
          and while one is pending its screens stand in for the route. */}
      <InvitationHost>
        <Routes>
          {LANDING_PATHS.map((landingPath) => (
            // Only `/` bounces a signed-in visitor into the app: `/docs` and
            // `/preview` are reference pages.
            <Route key={landingPath} path={landingPath} element={<FrontDoor bounce={landingPath === "/"} />} />
          ))}
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/teams" element={<RequireAuth><TeamsPage /></RequireAuth>} />
          <Route path="/teams/:teamId/projects" element={<RequireAuth><ProjectsPage /></RequireAuth>} />
          <Route path="/teams/:teamId/projects/:projectId" element={<RequireAuth><ProjectRoute /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </InvitationHost>
    </ToastProvider>
  );
}
