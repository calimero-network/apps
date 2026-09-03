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

import React from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { AppMode, MeroProvider } from '@calimero-network/mero-react';
import { ToastProvider } from '@calimero-network/mero-ui';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { DriveWorkspaceProvider } from '@/hooks/useDriveWorkspace';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { PACKAGE_NAME } from '@/constants/config';
import { hasInvitePayload } from '@/hooks/useNamespaceInvitation';

import LandingPage from './pages/landing';
import Authenticate from './pages/login/Authenticate';
import WorkspacePage from './pages/workspace';
import JoinPage from './pages/join';

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
        <ToastProvider>
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
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/login" element={<Authenticate />} />
                  <Route path="/join" element={<JoinPage />} />
                  <Route
                    path="/app/*"
                    element={
                      <DriveWorkspaceProvider>
                        <WorkspacePage />
                      </DriveWorkspaceProvider>
                    }
                  />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </BrowserRouter>
            </ConfirmProvider>
          </TooltipProvider>
        </ToastProvider>
      </MeroProvider>
    </ThemeProvider>
  );
}
