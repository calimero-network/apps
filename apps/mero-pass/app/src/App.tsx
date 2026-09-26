import { type ReactNode } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';

import InvitationPrompt from './components/InvitationPrompt';
import { useAutoLock, useAutoLockMinutes } from './hooks/useDeviceLock';
import LandingPage from './pages/landing/LandingPage';
import TeamsPage from './pages/teams/TeamsPage';
import TeamPage from './pages/team/TeamPage';
import SecurityPage from './pages/security/SecurityPage';
import SharePage from './pages/share/SharePage';
import VaultPage from './pages/vault/VaultPage';

/**
 * Every path the shared landing page serves.
 *
 * ⚠️ `/landing` IS ONE OF THEM, and its absence was a real bug. The word is the
 * obvious guess for a marketing page — the user typed it — and it used to match
 * no route at all.
 */
const LANDING_PATHS = ['/', '/landing', '/docs', '/preview'];

/**
 * An authenticated visitor has no business on the marketing page.
 *
 * ⚠️ THIS IS THE STEP THAT CARRIES YOU INTO THE APP. The SSO callback returns
 * to wherever login started — `connectToNode` uses `window.location.href` as
 * the callback URL — which for a visitor who pressed Connect on the landing
 * page is `/`. Without this the tokens land, `isAuthenticated` flips true, and
 * the router renders the landing page again.
 *
 * `replace`, always: a redirect that pushes leaves the guarded path in history,
 * so Back returns to it and is immediately redirected forward again — a trap
 * the user cannot escape with the browser's own controls.
 */
function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  if (isLoading) return null; // the auth probe is still in flight
  if (isAuthenticated) return <Navigate to="/teams" replace />;
  return <>{children}</>;
}

/**
 * Anything that matched no route.
 *
 * ── THE BUG THIS FIXES ──────────────────────────────────────────────────────
 *
 * There was no catch-all. `/landing`, a typo, an old bookmark and every deep
 * link this app has ever renamed all fell through to NOTHING: React Router
 * matched no route, so `#root` rendered an empty div. Reproduced against the
 * deployed build — `/landing` and `/nope` both came back with a 128-character
 * root and zero links or buttons.
 *
 * A blank page is not merely ugly here, it is the start of the loop the user
 * hit. There is nothing to click, so the only move is to retry the connect
 * flow; `connectToNode` uses `window.location.href` as its callback URL, the
 * callback comes back with `#node_url=…&access_token=…` appended, the provider
 * strips it once, and every retry after that CONCATENATES another fragment
 * onto a URL that still renders nothing. Reproduced live:
 *
 *   /landing
 *   /landing#node_url=…&access_token=…&refresh_token=…&expires_at=1
 *   /landing#node_url=…&access_token=…&expires_at=1#node_url=…&access_token=…
 *
 * — a URL of `&`-separated fragments growing without bound, which is the
 * "/~&~&~&///" the user reported.
 *
 * So the catch-all is TERMINAL by construction: it renders no UI of its own and
 * navigates exactly once, with `replace`, to a path that has a real route and
 * whose own guard cannot send it back here. `/teams` has no guard at all; `/`
 * renders the landing page for a signed-out visitor. Neither can return to a
 * `*` match, so there is no cycle to enter.
 */
function CatchAll() {
  const { isAuthenticated, isLoading } = useMero();
  // Navigating before the probe resolves would send a signed-in visitor to the
  // marketing page and then bounce them forward — two redirects where one will
  // do, and a flash of the wrong page.
  if (isLoading) return null;
  return <Navigate to={isAuthenticated ? '/teams' : '/'} replace />;
}

/** `/space/:id` was this app's name for a team until it had a better one. */
function LegacyTeamRedirect() {
  const { teamId } = useParams<{ teamId: string }>();
  return <Navigate to={teamId ? `/teams/${teamId}` : '/teams'} replace />;
}

export default function App() {
  const [lockMinutes] = useAutoLockMinutes();
  useAutoLock(lockMinutes);
  return (
    <>
      {/* ⚠️ APP LEVEL, not inside a route. An invitation link can land on any
          path, and a prompt mounted on one page misses on every other one. It
          renders nothing until an invitation is actually captured. */}
      <InvitationPrompt />
      <Routes>
        {/* The landing page is four URLs so they can be shared and opened cold.
            Only `/` and `/landing` bounce a signed-in visitor into the app —
            `/docs` and `/preview` are reference pages, and somebody signed in
            is exactly who wants to read them. */}
        {LANDING_PATHS.map((path) => (
          <Route
            key={path}
            path={path}
            element={
              path === '/' || path === '/landing' ? (
                <RedirectIfAuthed>
                  <LandingPage />
                </RedirectIfAuthed>
              ) : (
                <LandingPage />
              )
            }
          />
        ))}

        {/* The /login PAGE is gone — its whole content was a button the visitor
            had already pressed to get there. The path stays as a redirect so a
            bookmark lands on the front door instead of a blank route. */}
        <Route path="/login" element={<Navigate to="/" replace />} />

        {/* A TEAM is a namespace: the people, and the vaults they share. */}
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/teams/:teamId" element={<TeamPage />} />
        {/* A VAULT is a context, so the param is a context id. */}
        <Route path="/vault/:vaultId" element={<VaultPage />} />
        <Route path="/security" element={<SecurityPage />} />
        {/* PUBLIC: a share link carries its secret in the fragment, so the
            recipient needs no node and no login to open it. */}
        <Route path="/share" element={<SharePage />} />

        {/* Paths this app used before the nouns settled. Kept as terminal
            redirects so a bookmark or an open tab still lands somewhere real. */}
        <Route path="/home" element={<Navigate to="/teams" replace />} />
        <Route path="/space/:teamId" element={<LegacyTeamRedirect />} />
        <Route path="/space" element={<Navigate to="/teams" replace />} />

        <Route path="*" element={<CatchAll />} />
      </Routes>
    </>
  );
}
