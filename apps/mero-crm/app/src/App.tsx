import { useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { ToastProvider } from "@calimero-network/mero-ui";
import { nodeBasename } from "@calimero-apps/node-served";

import LandingPage from "./pages/landing/LandingPage";
import AppPage from "./pages/app/AppPage";
import PipelinePage from "./pages/app/PipelinePage";
import DealsPage from "./pages/app/DealsPage";
import DealDetailPage from "./pages/app/DealDetailPage";
import ActivitiesPage from "./pages/app/ActivitiesPage";
import ContactsPage from "./pages/app/ContactsPage";
import InsightsPage from "./pages/app/InsightsPage";
import SettingsPage from "./pages/app/SettingsPage";
import MembersPage from "./pages/app/MembersPage";
import InvitationHost from "./components/InvitationHost";
import SignInModal from "./components/SignInModal";
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
  if (api.session.status === "connecting") return null;
  if (api.session.status !== "signed-in") return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { api } = useSessionApi();
  if (api.session.status === "connecting") return null;
  if (api.session.status === "signed-in") return <Navigate to={APP_ROUTE} replace />;
  return <>{children}</>;
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
                <Route index element={<PipelinePage />} />
                <Route path="deals" element={<DealsPage />} />
                <Route path="deals/:id" element={<DealDetailPage />} />
                <Route path="activities" element={<ActivitiesPage />} />
                <Route path="contacts" element={<ContactsPage />} />
                <Route path="insights" element={<InsightsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="members" element={<MembersPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AppThemeProvider>
      </ToastProvider>
    </SessionProvider>
  );
}

export type AppElement = React.ReactElement;
