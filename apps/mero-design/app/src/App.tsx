import { useState, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import LandingPage from "./pages/landing/LandingPage";
import DesignShell from "./components/shell/DesignShell";
import TeamIndex from "./pages/TeamIndex";
import TeamHome from "./pages/TeamHome";
import BoardResolver from "./pages/BoardResolver";
import CanvasPage from "./pages/CanvasPage";
import { ToastProvider } from "./contexts/ToastContext";
import InvitationPage from "./components/InvitationPage";
import InvitationPrompt from "./components/InvitationPrompt";
import SignInModal from "./components/SignInModal";
import type { SessionDeps } from "./session";
import { SessionProvider, useAuth } from "./sessionContext";
import { nodeBasename } from "./utils/servedByNode";
import { deferInvite, inviteDeferred, invites, joinedAtSignUpPending } from "./utils/inviteLink";

/** Where a signed-out visitor was going when the guard sent them to the front door. */
type FromState = { from?: string } | null;

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ['/', '/docs', '/preview'];


function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return null; // wait for the auth probe; avoids a flash to /login
  // The route travels with the redirect, so signing in on the front door goes
  // on to the page the link named rather than to the team list.
  if (!isAuthenticated) {
    return <Navigate to="/" replace state={{ from: `${location.pathname}${location.search}` } satisfies FromState} />;
  }
  return <>{children}</>;
}


/**
 * An authenticated visitor has no business on the marketing page: a passkey
 * sign-in on `/` (or a session restored on load) carries you into the app.
 */
function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const from = (useLocation().state as FromState)?.from;
  if (isLoading) return null; // the auth probe is still in flight
  // `/teams` goes on by itself to the team and board open last (TeamIndex).
  // With an invitation waiting, the page asked for comes AFTER joining
  // (InvitationPrompt goes there): opened before, it is not yours to read yet.
  // Joined at sign-up: InvitationPrompt is opening the page the link named.
  if (isAuthenticated && joinedAtSignUpPending()) return null;
  if (isAuthenticated) return <Navigate to={(invites.token() ? null : from) ?? "/teams"} replace />;
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

/**
 * The landing page with the passkey sign-in as its connect action.
 *
 * Signed out with an invitation waiting, the invitation IS the page: no hero
 * behind it, no popup, no extra click. "Not now" comes back here to the
 * ordinary page, keeping the token for a later sign-in.
 */
function Landing() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [signingIn, setSigningIn] = useState(false);
  const [deferred, setDeferred] = useState(() => inviteDeferred());
  if (!isAuthenticated && !isLoading && !deferred && invites.token()) {
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
  );
}

export default function App({ deps }: { deps?: SessionDeps } = {}) {
  return (
    // SessionProvider connects (merod local in dev, the Cloud cluster in
    // production) and binds the signed-in client for the data layer in src/api.
    <SessionProvider deps={deps}>
      <BrowserRouter basename={nodeBasename()}>
        <AppRoutes />
      </BrowserRouter>
    </SessionProvider>
  );
}
