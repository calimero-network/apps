import { useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { InviteStore } from '@calimero-apps/connect';
import { usePendingInvite } from '@calimero-apps/passkey';
import { ToastProvider } from './contexts/ToastContext';

import MatchPage from './pages/match';
import HomePage from './pages/home';
import LandingPage from './pages/landing/LandingPage';
import AppFooter from './components/AppFooter';
import ConnectCard from './components/ConnectCard';
import { basename, invites as appInvites } from './lobbies';
import PlayPage from './pages/play';
import { SessionProvider } from './SessionProvider';
import { defaultDeps, describeTarget, useInviteState, useSessionApi, type SessionDeps } from './session';

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ['/', '/docs', '/preview'];

/**
 * The landing page, told who is looking at it. Sign-in is a passkey on the
 * lobby page, so "Sign in" goes there: there is no login popup and no node to
 * pick (the build fixes where the app connects).
 */
function AppLandingPage() {
  const { session } = useSessionApi();
  const navigate = useNavigate();
  return (
    <LandingPage
      isAuthenticated={session.status === 'signed-in'}
      onOpenApp={() => navigate('/lobby')}
      onConnect={() => navigate('/lobby')}
    />
  );
}

/**
 * A signed-in visitor has no business on the marketing page: `/` sends them
 * into the app. Asking for the landing page ON PURPOSE (the footer links set
 * router state `fromApp`) is let through.
 */
function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { session } = useSessionApi();
  const location = useLocation();
  const deliberate = (location.state as { fromApp?: boolean } | null)?.fromApp === true;
  if (session.status === 'connecting') return null;
  if (session.status === 'signed-in' && !deliberate) return <Navigate to="/lobby" replace />;
  return <>{children}</>;
}

/**
 * A signed-out visitor who opened an invitation link sees the invitation as a
 * page, in place of whatever route the link named: the lobby's own sign-in
 * card saying what they were invited to, with no landing hero behind it and
 * no extra click. Nothing navigates, so the address is still the deep link
 * once they are signed in; the lobby page then asks before joining and opens
 * the lobby the link names. "Not now" falls through to the routes and keeps
 * the token.
 */
function InvitationGate({ children }: { children: ReactNode }) {
  const api = useSessionApi();
  const pending = usePendingInvite(useInviteState().invites);
  const [notNow, setNotNow] = useState(false);
  if (api.session.status === 'signed-out' && !notNow && pending) {
    return (
      <div className="app-bg" data-testid="invitation-page">
        <div className="page-shell">
          <div className="page-content">
            <ConnectCard api={api} where={describeTarget(api.session.target)} onNotNow={() => setNotNow(true)} />
            <AppFooter />
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App({
  deps = defaultDeps,
  invites = appInvites,
}: {
  deps?: SessionDeps;
  /** The pending-invite store; the module's own unless a test passes one. */
  invites?: InviteStore;
}) {
  return (
    <SessionProvider deps={deps} invites={invites}>
      <ToastProvider>
        <BrowserRouter basename={basename()}>
          <InvitationGate>
            <Routes>
              {/* The landing page is three pages: `/`, `/docs` and `/preview`,
                  real URLs so they can be shared and opened cold. Only `/`
                  bounces a signed-in visitor into the app. */}
              {LANDING_PATHS.map((landingPath) => (
                <Route
                  key={landingPath}
                  path={landingPath}
                  element={
                    landingPath === '/' ? (
                      <RedirectIfAuthed>
                        <AppLandingPage />
                      </RedirectIfAuthed>
                    ) : (
                      <AppLandingPage />
                    )
                  }
                />
              ))}
              <Route path="/login" element={<Navigate to="/lobby" replace />} />
              <Route path="/lobby" element={<MatchPage />} />
              <Route path="/match" element={<MatchPage />} />
              <Route path="/home" element={<HomePage />} />
              <Route path="/play" element={<PlayPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </InvitationGate>
        </BrowserRouter>
      </ToastProvider>
    </SessionProvider>
  );
}
