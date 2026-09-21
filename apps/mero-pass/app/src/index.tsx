import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppMode, MeroProvider } from '@calimero-network/mero-react';
import './index.css';
import App from './App';
import { bootstrapDesktopSession, hashNodeUrl } from './auth/desktopBootstrap';

// ── Desktop SSO ───────────────────────────────────────────────────────────────
//
// tauri-app opens this app in a WebviewWindow with the session in the URL hash:
//
//   …#node_url=…&access_token=…&refresh_token=…&app-id=…&expires_at=…
//
// SSO is owned by MeroProvider, NOT by us: on first render it runs
// `parseAuthCallback(window.location.href)`, reads the tokens out of the hash,
// stores them in mero-js's token store and strips the hash. So the hash must be
// left INTACT here — hand-rolling the seeding is what disables
// `resolveTokenAdoption`, and several apps in the fleet quietly downgraded
// themselves that way.
//
// mero-react >= 4.1 also REJECTS a callback whose node_url is not explicitly
// trusted, dropping the tokens with nothing but a console error. Every user runs
// their own node, so the only workable trust anchor is the node_url the desktop
// handed us in THIS open's hash — read before MeroProvider strips it.
//
// ⚠️ TWO THINGS WERE MISSING HERE, and both fail silently.
//
// 1. The application id was never seeded. The desktop spells it `app-id`,
//    with a hyphen; mero-react reads `application_id`. So this app took the
//    tokens and dropped the app id, then resolved one itself — signing you in
//    against no application, or against whichever install the fallback picked.
//    That is the "auth skip" not working. `bootstrapDesktopSession` seeds the
//    keys mero-react actually reads, before React mounts.
//
// 2. `allowedNodeUrls` got the RAW url. mero-react compares trust BY ORIGIN,
//    so a value carrying a path or trailing slash never matches: the callback
//    is rejected and the tokens dropped with only a console error, leaving the
//    person on the connect screen having just signed in.
//
// Ported verbatim from mero-sign's `auth/desktopBootstrap`, which carries the
// same file for the same reason — identical on purpose so they cannot drift.
bootstrapDesktopSession();
const nodeUrlAnchor = hashNodeUrl();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);
root.render(
  <React.StrictMode>
    <MeroProvider
      mode={AppMode.MultiContext}
      // The registry resolves the installed application per node. The old code
      // hard-coded a `clientApplicationId` — an ApplicationId is assigned PER
      // INSTALL, so a baked one is wrong on every node but the machine it was
      // copied from, and core answers a request naming an unknown application
      // with an opaque 500 rather than a 404.
      // ⚠️ `?.trim() ||`, never `??`. Vercel inlines a defined-but-EMPTY env
      // var as `""`, which `??` happily keeps — and an empty packageName makes
      // `buildAuthLoginUrl` drop the `package-name` param entirely. Without it
      // auth-frontend cannot look the app up in the registry to authorize the
      // callback origin, so a hosted login dies on "Login callback destination
      // is not allowed". That is exactly what shipped on mero-design.
      packageName={
        import.meta.env.VITE_APPLICATION_PACKAGE?.trim() ||
        'com.calimero.mero-pass'
      }
      registryUrl="https://apps.calimero.network"
      allowedNodeUrls={nodeUrlAnchor ? [nodeUrlAnchor] : undefined}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MeroProvider>
  </React.StrictMode>,
);
