import { type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { nodeBasename } from '@calimero-apps/node-served';
import { ToastProvider } from './contexts/ToastContext';

import MatchPage from './pages/match';
import HomePage from './pages/home';
import LandingPage from './pages/landing/LandingPage';
import PlayPage from './pages/play';
import { SessionProvider } from './SessionProvider';
import { defaultDeps, useSessionApi, type SessionDeps } from './session';

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ['/', '/docs', '/preview'];

/**
 * The landing page, told who is looking at it. Sign-in is a passkey on the
 * lobby page, so "Connect" goes there: there is no login popup and no node to
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

export default function App({ deps = defaultDeps }: { deps?: SessionDeps }) {
  return (
    <SessionProvider deps={deps}>
      <ToastProvider>
        <BrowserRouter basename={nodeBasename(new URL(window.location.href), '/')}>
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
        </BrowserRouter>
      </ToastProvider>
    </SessionProvider>
  );
}
