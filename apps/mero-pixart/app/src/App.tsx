import { useState, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { nodeBasename } from "@calimero-apps/node-served";
import LandingPage from "./pages/landing/LandingPage";
import TeamsPage from "./pages/TeamsPage";
import ProjectsPage from "./pages/ProjectsPage";
import EditorPage from "./pages/EditorPage";
import InvitationPrompt from "./components/InvitationPrompt";
import SignInModal from "./components/SignInModal";
import { ToastProvider } from "./contexts/ToastContext";
import type { SessionDeps } from "./session";
import { SessionProvider, useSessionApi } from "./sessionContext";

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ["/", "/docs", "/preview"];

/** Signed in, signed out, or still connecting (restoring a stored session). */
function useAuth(): { isAuthenticated: boolean; isLoading: boolean } {
  const { api } = useSessionApi();
  return {
    isAuthenticated: api.session.status === "signed-in",
    isLoading: api.session.status === "connecting",
  };
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null; // restoring a stored session: no flash of the landing page
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * An authenticated visitor has no business on the marketing page: into the
 * app, resuming the team (and project) open last.
 */
function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/teams" replace state={{ resume: true }} />;
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
        onOpenApp={() => navigate("/teams")}
      />
      <SignInModal open={signingIn} onClose={() => setSigningIn(false)} />
    </>
  );
}

function AppRoutes() {
  return (
    <ToastProvider>
      {/* Above the routes: an invitation link can open this app on any page. */}
      <InvitationPrompt />
      <Routes>
        {/* The landing page is three pages: `/`, `/docs` and `/preview`, real
            URLs so they can be shared and opened cold. Only `/` bounces a
            signed-in visitor into the app. */}
        {LANDING_PATHS.map((landingPath) => (
          <Route
            key={landingPath}
            path={landingPath}
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
        <Route path="/login" element={<Navigate to="/" replace />} />
        {/* Teams are organizations; projects are app instances in one. */}
        <Route path="/teams" element={<RequireAuth><TeamsPage /></RequireAuth>} />
        <Route path="/teams/:teamId/projects" element={<RequireAuth><ProjectsPage /></RequireAuth>} />
        <Route path="/teams/:teamId/projects/:projectId" element={<RequireAuth><EditorPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
