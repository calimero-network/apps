import { useCallback, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { ToastProvider } from '@calimero-network/mero-ui';
import { nodeBasename } from '@calimero-apps/node-served';

import LandingPage from './pages/landing/LandingPage';
import AppPage from './pages/app/AppPage';
import InvitationPage from './components/InvitationPage';
import InvitationPrompt from './components/InvitationPrompt';
import SignInModal from './components/SignInModal';
import { APP_ROUTE } from './config';
import { pendingInvite, type AcceptedInvite } from './lib/workspaces';
import type { SessionDeps } from './session';
import { SessionProvider, useSessionApi } from './sessionContext';

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ['/', '/docs', '/preview'];

/** Signed in, signed out, or still connecting (restoring a stored session). */
function useAuth(): { isAuthenticated: boolean; isLoading: boolean } {
  const { api } = useSessionApi();
  return {
    isAuthenticated: api.session.status === 'signed-in',
    isLoading: api.session.status === 'connecting',
  };
}

/**
 * Route guards. Restoring a stored session is asynchronous, so both wait for
 * it rather than bouncing a signed-in visitor away on the first render.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to={APP_ROUTE} replace />;
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
        onOpenApp={() => navigate(APP_ROUTE)}
      />
      <SignInModal open={signingIn} onClose={() => setSigningIn(false)} />
    </>
  );
}

/**
 * The invitation prompt, mounted ABOVE the routes: a link can land on any
 * route, and a signed-out visitor goes through the sign-in first. Joining
 * navigates to the app route carrying what was joined, which the app page
 * hands to `useWorkspace().landJoined`.
 */
function AppInvitations() {
  const navigate = useNavigate();
  const onJoined = useCallback(
    (joined: AcceptedInvite) => navigate(APP_ROUTE, { state: { joined } }),
    [navigate],
  );
  return <InvitationPrompt onJoined={onJoined} />;
}

/**
 * A signed-out visitor who opened an invitation link sees the invitation as a
 * page, in place of whatever route the link named: no landing hero behind it
 * and no extra click to find the sign-in. Nothing navigates, so the address
 * (under the `/<version>/` basename) is still the deep link once they are
 * signed in, and the route guards never get the chance to bounce it to `/`.
 * "Not now" falls through to the routes and keeps the token.
 */
function InvitationGate({ children }: { children: ReactNode }) {
  const { api } = useSessionApi();
  const [notNow, setNotNow] = useState(false);
  if (api.session.status === 'signed-out' && !notNow && pendingInvite()) {
    return <InvitationPage onNotNow={() => setNotNow(true)} />;
  }
  return <>{children}</>;
}

export default function App({ deps }: { deps?: SessionDeps } = {}) {
  return (
    <SessionProvider deps={deps}>
      <ToastProvider>
        <BrowserRouter basename={nodeBasename(new URL(window.location.href), '/')}>
          <AppInvitations />
          <InvitationGate>
            <Routes>
              {LANDING_PATHS.map((landingPath) => (
                <Route
                  key={landingPath}
                  path={landingPath}
                  // Only `/` bounces a signed-in visitor into the app; `/docs` and
                  // `/preview` are reference pages.
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
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path={APP_ROUTE} element={<RequireAuth><AppPage /></RequireAuth>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </InvitationGate>
        </BrowserRouter>
      </ToastProvider>
    </SessionProvider>
  );
}
