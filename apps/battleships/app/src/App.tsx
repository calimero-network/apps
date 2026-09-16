import React, { type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppMode, MeroProvider, useMero } from '@calimero-network/mero-react';
import { ToastProvider } from './contexts/ToastContext';

import MatchPage from './pages/match';
import HomePage from './pages/home';
import LandingPage from './pages/landing/LandingPage';
import PlayPage from './pages/play';

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ['/', '/docs', '/preview'];


// ── Desktop auth-skip ─────────────────────────────────────────────────────────
//
// tauri-app opens an app at its registry `links.frontend` with the session
// already minted, in the URL fragment:
//
//   …#node_url=…&access_token=…&refresh_token=…&app-id=…&expires_at=…
//
// mero-react owns that hash — MeroProvider runs `parseAuthCallback` on its first
// render — but it will not store the tokens unless it can decide the node is
// trusted, and `resolveTrustedNodeUrl` is default-DENY:
//
//     candidate + initiated        -> accept only if same origin
//     candidate + allowedNodeUrls  -> accept only if listed
//     candidate + neither          -> REJECT
//
// "initiated" is the node THIS browser context started a login against, and a
// desktop hand-off never had one — the launcher did the login. So without an
// anchor a cold desktop open lands in the third branch, the provider logs
// "OAuth callback node_url is not trusted … no tokens stored" and NOTHING ELSE,
// and the user is left at the Connect screen holding a good session. This app
// had no anchor at all.
//
// Every user runs their own node, so there is no list to hard-code: the only
// workable anchor is the node the desktop handed us in THIS open's hash. Read at
// module scope, because the provider strips the hash after its first render and
// a value recomputed on re-render would flip to null underneath it.
//
// No hash means no anchor and the strict behaviour is unchanged, so an ordinary
// web visit and the web login redirect both behave exactly as before.
const hashNodeUrl =
  typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.hash.slice(1)).get('node_url');

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
/**
 * The landing page, told who is looking at it.
 *
 * ⚠️ `useMero()` lives HERE, not in `LandingPage`. That component is generated
 * from a template shared by fourteen apps, three of which render it with no
 * `MeroProvider` above them — the hook would throw for those. So the app, which
 * knows it has a provider, reads the session and hands the answer down.
 *
 * `/home` rather than `/lobby`: it is the same entry the post-login guard uses,
 * so "Open application" and signing in land in exactly the same place.
 */
function AppLandingPage() {
  const { isAuthenticated } = useMero();
  const navigate = useNavigate();
  return (
    <LandingPage
      isAuthenticated={isAuthenticated}
      onOpenApp={() => navigate('/home')}
    />
  );
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  const location = useLocation();
  // Asking for the landing page ON PURPOSE — the in-app logo link — is not the
  // case this guard exists for, so it is let through.
  //
  // ⚠️ ROUTER STATE, deliberately, not a query parameter. State lives in the
  // history entry and never survives a fresh document load, so the SSO callback
  // — which arrives as a cold navigation to `/` — cannot carry it even if the
  // URL it returns to was captured from a page that had it. A `?from=app`
  // marker WOULD ride along in that URL and would reintroduce exactly the bug
  // the comment above describes: login succeeding and landing you back on the
  // marketing page.
  const deliberate = (location.state as { fromApp?: boolean } | null)?.fromApp === true;
  if (isLoading) return null; // the auth probe is still in flight
  if (isAuthenticated && !deliberate) return <Navigate to="/home" replace />;
  return <>{children}</>;
}

export default function App() {
  // Both default to the published values so a plain `vite build` — Vercel's
  // included — resolves the application id off the registry with no env at all.
  // mero-js only forwards `package-name`/`registry-url` to /auth/login when
  // BOTH are truthy, so leaving either undefined means the login callback
  // carries no applicationId and there is nothing to fall back to.
  const packageName =
    import.meta.env.VITE_PACKAGE_NAME?.trim() || 'com.calimero.battleships';
  const registryUrl =
    import.meta.env.VITE_REGISTRY_URL?.trim() || 'https://apps.calimero.network';

  return (
    <MeroProvider
      mode={AppMode.MultiContext}
      packageName={packageName}
      registryUrl={registryUrl}
      allowedNodeUrls={hashNodeUrl ? [hashNodeUrl] : undefined}
    >
      <ToastProvider>
        <BrowserRouter basename="/">
          <Routes>
            {/* The explainer is the front door. A signed-in visitor who comes
                back here from inside the app — the in-app footer links to it —
                is offered "Open application" rather than a second sign-in. */}
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
                      <AppLandingPage />
                    </RedirectIfAuthed>
                  ) : (
                    <AppLandingPage />
                  )
                }
              />
            ))}
            {/* The /login PAGE is gone — every app had one, every one looked
                different, and its whole content was a button the visitor had
                already pressed to get there. The path stays as a redirect so a
                bookmark lands on the front door instead of a blank route. */}
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/lobby" element={<MatchPage />} />
            <Route path="/match" element={<MatchPage />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/play" element={<PlayPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </MeroProvider>
  );
}
