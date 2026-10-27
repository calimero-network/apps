import { type ReactNode } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useMero } from "@calimero-apps/cloud";
import LandingPage from "./pages/landing/LandingPage";
import DesignShell from "./components/shell/DesignShell";
import TeamIndex from "./pages/TeamIndex";
import TeamHome from "./pages/TeamHome";
import BoardResolver from "./pages/BoardResolver";
import CanvasPage from "./pages/CanvasPage";
import { ToastProvider } from "./contexts/ToastContext";
import { ApiBinder } from "./api/ApiBinder";
import InvitationPrompt from "./components/InvitationPrompt";

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
  // `/teams` goes on by itself to the team and board open last (TeamIndex).
  if (isAuthenticated) return <Navigate to="/teams" replace />;
  return <>{children}</>;
}

/**
 * A board, mounted fresh per board. Switching boards from the rail used to be
 * impossible without leaving the page (back to the list, into the next one),
 * which unmounted it; keyed, a switch still starts from a clean canvas.
 */
function BoardRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  return <CanvasPage key={projectId} />;
}

export default function App() {
  return (
    // ApiBinder publishes the session's clients (rpc / admin / events) to the
    // plain-function data layer in src/api — see api/client.tsx.
    <ApiBinder>
    <ToastProvider>
      {/* Above the routes: an invitation link can open this app on any page. */}
      <InvitationPrompt />
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
        {/* Every signed-in screen is one frame (DesignShell): top bar, boards
            rail, and the team home or a board in the middle. The URLs are the
            ones the separate pages had, so old links and bookmarks still land:
              /teams                          → the last team (TeamIndex)
              /teams/:teamId[/projects]       → that team's boards
              /teams/:teamId/projects/:id     → a board
              /boards/:id                     → a board, its team looked up
            Settings is `?settings=team|board` on any of them. */}
        <Route element={<RequireAuth><DesignShell /></RequireAuth>}>
          <Route path="/teams" element={<TeamIndex />} />
          <Route path="/teams/:teamId" element={<Navigate to="projects" replace />} />
          <Route path="/teams/:teamId/projects" element={<TeamHome />} />
          <Route path="/teams/:teamId/projects/:projectId" element={<BoardRoute />} />
          <Route path="/boards/:projectId" element={<BoardResolver />} />
        </Route>
        {/* A path no page owns lands on the front door, as a node serves every unknown client route. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
    </ApiBinder>
  );
}
