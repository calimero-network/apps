// Root of the app. Mirrors battleships' App.tsx shape exactly: a
// single MeroProvider at the top, then the UI-level providers, then
// the router. No session-timeout logic here — the per-page guard in
// pages/workspace/index.tsx handles the "not authenticated" branch,
// and Phase 3's useDriveWorkspace owns any cache invalidation on
// namespace switch / logout.
//
// Env vars consumed:
//   VITE_PACKAGE_NAME    — passed to MeroProvider so the OAuth flow
//                          can resolve the application id from the
//                          public registry
//   VITE_REGISTRY_URL    — optional registry override (self-hosted)
//
// Routes:
//   /          → landing page (public)
//   /login     → Authenticate (ConnectButton entry)
//   /app/*     → WorkspacePage (auth-guarded shell, mounts
//                 WorkspaceLayout)
//   *          → redirect to /

import React, { type ReactNode } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { AppMode, MeroProvider, useMero } from '@calimero-network/mero-react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { DriveWorkspaceProvider } from '@/hooks/useDriveWorkspace';
import { ThemeProvider, useTheme } from '@/components/theme/ThemeProvider';
import { PACKAGE_NAME } from '@/constants/config';
import { hasInvitePayload } from '@/hooks/useNamespaceInvitation';

import DevPanel from '@/components/dev/DevPanel';

import LandingPage from './pages/landing/LandingPage';
import WorkspacePage from './pages/workspace';
import JoinPage from './pages/join';

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ['/', '/docs', '/preview'];
// Clears EditorStatusBar's bottom bar so a toast never covers "Saved • E2E Encrypted".
const TOAST_BOTTOM_OFFSET = 64;


// Deep-link landings arrive on the frontend ROOT with the forwarded query
// (links.calimero.network appends the full query string), so an
// `invitation`/`invite` param on any route funnels into the /join flow.
// history-replace so refresh/back does not re-trigger the redirect.
function InviteRedirect() {
  const location = useLocation();
  const navigate = useNavigate();
  React.useEffect(() => {
    if (location.pathname === '/join') return;
    const params = new URLSearchParams(location.search);
    if (hasInvitePayload(params)) {
      navigate(`/join?${params.toString()}`, { replace: true });
    }
  }, [location, navigate]);
  return null;
}

// ── Desktop auth-skip ─────────────────────────────────────────────────────────
//
// tauri-app opens an app at its registry `links.frontend` with the session
// already minted, in the URL fragment:
//
//   …#node_url=…&access_token=…&refresh_token=…&app-id=…&expires_at=…
//
// mero-react owns that hash — MeroProvider runs `parseAuthCallback` on its first
// render — but it will not store the tokens unless it can decide the node is
// trusted, and `resolveTrustedNodeUrl` (present since 4.2.0, so also in
// the 4.6.1 this app pins) is default-DENY:
//
//     candidate + initiated        -> accept only if same origin
//     candidate + allowedNodeUrls  -> accept only if listed
//     candidate + neither          -> REJECT
//
// "initiated" is the node THIS browser context started a login against, and a
// desktop hand-off never had one — the launcher did the login. So without an
// anchor a cold desktop open lands in the third branch, the provider logs
// "OAuth callback node_url is not trusted … no tokens stored" and NOTHING ELSE,
// and the user is left at the Connect screen holding a good session. This file
// says it "mirrors battleships' App.tsx shape exactly", and it inherited that
// app's missing anchor along with the shape.
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
function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  const location = useLocation();
  // ⚠️ An invite link beats this redirect. links.calimero.network forwards the
  // invite query to the frontend ROOT, so a signed-in person who clicks one
  // lands on `/` holding an `invitation` param, and two effects then fire in
  // the same commit: InviteRedirect's `navigate('/join?…')` and this
  // component's `<Navigate to="/app">`. `Navigate` renders deeper in the tree,
  // so its effect runs LAST and wins — and `to="/app"` carries no query, so
  // the invitation is gone. The invite simply vanished for exactly the people
  // most likely to have one: existing users. Standing down here leaves
  // InviteRedirect's navigation the only one in flight.
  if (hasInvitePayload(new URLSearchParams(location.search))) return null;
  if (isLoading) return null; // the auth probe is still in flight
  if (isAuthenticated) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

/** `*` → `/`, keeping the query. See the route comment below. */
function CatchAllRedirect() {
  const location = useLocation();
  const search = location.search;
  return <Navigate to={search ? `/${search}` : '/'} replace />;
}

// `!` is needed: sonner's own colour rules outrank plain utility classes.
function AppToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      offset={{ bottom: TOAST_BOTTOM_OFFSET }}
      toastOptions={{
        classNames: {
          toast: '!bg-card !text-card-foreground !border-border',
          description: '!text-muted-foreground',
          title: '!text-destructive',
          icon: '!text-destructive',
        },
      }}
    />
  );
}

export default function App() {
  const packageName = PACKAGE_NAME || undefined;
  const registryUrl =
    import.meta.env.VITE_REGISTRY_URL?.trim() || 'https://apps.calimero.network';

  return (
    <ThemeProvider>
      <MeroProvider
        mode={AppMode.MultiContext}
        packageName={packageName}
        registryUrl={registryUrl}
        allowedNodeUrls={hashNodeUrl ? [hashNodeUrl] : undefined}
      >
        <AppToaster />
        <TooltipProvider>
          <ConfirmProvider>
            <BrowserRouter
              future={{
                v7_startTransition: true,
                v7_relativeSplatPath: true,
              }}
            >
              <InviteRedirect />
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
                <Route path="/join" element={<JoinPage />} />
                <Route
                  path="/app/*"
                  element={
                    <DriveWorkspaceProvider>
                      <WorkspacePage />
                    </DriveWorkspaceProvider>
                  }
                />
                {/* The catch-all drops the query string, which for an invite
                    deep link IS the invitation. InviteRedirect has already
                    run by the time this renders, but its navigation is
                    applied in an effect — so preserve the search here rather
                    than racing it. */}
                <Route path="*" element={<CatchAllRedirect />} />
              </Routes>
            </BrowserRouter>
            {import.meta.env.DEV && <DevPanel />}
          </ConfirmProvider>
        </TooltipProvider>
      </MeroProvider>
    </ThemeProvider>
  );
}
