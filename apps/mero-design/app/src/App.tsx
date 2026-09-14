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
  if (isAuthenticated) return <Navigate to="/teams" replace />;
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
        <Route path="/teams" element={<RequireAuth><TeamsPage /></RequireAuth>} />
        <Route path="/teams/:teamId/projects" element={<RequireAuth><ProjectsPage /></RequireAuth>} />
        <Route path="/teams/:teamId/projects/:projectId" element={<RequireAuth><CanvasPage /></RequireAuth>} />
      </Routes>
    </ToastProvider>
  );
}
