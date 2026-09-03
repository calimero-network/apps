import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppMode, MeroProvider } from '@calimero-network/mero-react';
import { ToastProvider } from '@calimero-network/mero-ui';

import MatchPage from './pages/match';
import HomePage from './pages/home';
import Authenticate from './pages/login/Authenticate';
import PlayPage from './pages/play';

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
            <Route path="/" element={<Authenticate />} />
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
