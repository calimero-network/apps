import { useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ToastProvider } from "@calimero-network/mero-ui";
import { nodeBasename } from "@calimero-apps/node-served";

import LandingPage from "./pages/landing/LandingPage";
import AppPage from "./pages/app/AppPage";
import IssuesView from "./pages/app/IssuesView";
import IssueDetailPage from "./pages/app/IssueDetailPage";
import BoardPage from "./pages/app/BoardPage";
import MembersPage from "./pages/app/MembersPage";
import InvitationHost from "./components/InvitationHost";
import SignInModal from "./components/SignInModal";
import InvitationPage from "./components/InvitationPage";
import { pendingInvite } from "./workspaces";
import { AppThemeProvider } from "./theme";
import { APP_ROUTE } from "./config";
import { SessionProvider, useSessionApi } from "./sessionContext";
import type { SessionDeps } from "./session";

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ["/", "/docs", "/preview"];

/**
 * Route guards. The session resolves asynchronously (`connecting` while the
 * client attests a node and a stored session is restored), so both guards
 * wait for it before redirecting; otherwise a refresh on a protected route
 * bounces a signed-in person to the landing page.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { api } = useSessionApi();
  const location = useLocation();
  if (api.session.status === "connecting") return null;
  if (api.session.status !== "signed-in") {
    // Remember where they were going: signing in from the landing page then
    // lands on that route, not the app's front screen.
    return <Navigate to="/" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { api } = useSessionApi();
  const from = (useLocation().state as { from?: unknown } | null)?.from;
  if (api.session.status === "connecting") return null;
  if (api.session.status === "signed-in") {
    const to = typeof from === "string" && from.startsWith(APP_ROUTE) ? from : APP_ROUTE;
    return <Navigate to={to} replace />;
  }
  return <>{children}</>;
}

/**
 * A signed-out visitor holding an invite (`?invite=`, taken into storage by
 * `index.tsx`) sees the invitation as a page instead of whatever the route
 * would render. The URL is left alone, so a deep link opens where it pointed
 * once they are signed in, with the join prompt (`InvitationHost`) on top.
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

/** The landing page with the passkey sign-in as its connect action. */
function Landing() {
  const { api } = useSessionApi();
  const navigate = useNavigate();
  const [signingIn, setSigningIn] = useState(false);
  return (
    <>
      <LandingPage
        onConnect={() => setSigningIn(true)}
        isAuthenticated={api.session.status === "signed-in"}
        onOpenApp={() => navigate(APP_ROUTE)}
      />
      {signingIn && <SignInModal onClose={() => setSigningIn(false)} />}
    </>
  );
}

export default function App({ deps }: { deps?: SessionDeps } = {}) {
  return (
    <SessionProvider deps={deps}>
      <ToastProvider>
        <AppThemeProvider>
          <BrowserRouter basename={nodeBasename(new URL(window.location.href), "/")}>
            {/* An invitation link can land on ANY route, so the prompt that
                offers it lives above the router's outlet. */}
            <InvitationHost />
            <InvitationGate>
              <Routes>
                {LANDING_PATHS.map((landingPath) => (
                  <Route
                    key={landingPath}
                    path={landingPath}
                    // Only `/` bounces a signed-in visitor into the app: `/docs`
                    // and `/preview` are reference pages.
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
                <Route
                  path={APP_ROUTE}
                  element={
                    <RequireAuth>
                      <AppPage />
                    </RequireAuth>
                  }
                >
                  <Route index element={<IssuesView />} />
                  <Route path="issues/:id" element={<IssueDetailPage />} />
                  <Route path="board" element={<BoardPage />} />
                  <Route path="members" element={<MembersPage />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </InvitationGate>
          </BrowserRouter>
        </AppThemeProvider>
      </ToastProvider>
    </SessionProvider>
  );
}

export type AppElement = React.ReactElement;
