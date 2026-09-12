import { type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import LandingPage from "./pages/landing/LandingPage";
import TeamsPage from "./pages/TeamsPage";
import ProjectsPage from "./pages/ProjectsPage";
import CanvasPage from "./pages/CanvasPage";
import { ToastProvider } from "./contexts/ToastContext";

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ['/', '/docs', '/preview'];


function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  if (isLoading) return null; // wait for the auth probe; avoids a flash to /login
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}


export default function App() {
  return (
    <ToastProvider>
      <Routes>
        {/* The landing page is three pages: `/`, `/docs` and `/preview`. They are
            real URLs so they can be shared and opened cold, which needs a route
            here — otherwise this app's catch-all swallows the deep link before
            the page ever renders. */}
        {LANDING_PATHS.map((landingPath) => (
          <Route key={landingPath} path={landingPath} element={<LandingPage />} />
        ))}
        {/* The /login PAGE is gone — every app had one, every one looked
            different, and its whole content was a button the visitor had
            already pressed to get there. The path stays as a redirect so a
            bookmark lands on the front door instead of a blank route. */}
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/teams" element={<RequireAuth><TeamsPage /></RequireAuth>} />
        <Route path="/teams/:teamId/projects" element={<RequireAuth><ProjectsPage /></RequireAuth>} />
        <Route path="/teams/:teamId/projects/:projectId" element={<RequireAuth><CanvasPage /></RequireAuth>} />
      </Routes>
    </ToastProvider>
  );
}
