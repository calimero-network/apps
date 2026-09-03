import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { AppMode, CalimeroProvider } from '@calimero-network/calimero-client';
import { PACKAGE_NAME, REGISTRY_URL } from './constants/config';

// Disable StrictMode in production to avoid double-rendering
// which can cause 429 errors from CalimeroProvider's auth checks
const AppWrapper = import.meta.env.DEV ? StrictMode : React.Fragment;

// ── Desktop auth-skip ─────────────────────────────────────────────────────────
//
// The launcher opens an app at its registry `links.frontend` with the session
// already in the URL fragment. Read at module scope, before the provider's first
// render consumes and strips it. No hash means nothing is seeded, so an ordinary
// web visit is unchanged.
const hashNodeUrl =
  typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.hash.slice(1)).get('node_url');
if (hashNodeUrl) {
  try {
    // The legacy client reads its node from this key. Seeding it is what makes
    // the handed-over session usable instead of dropped — this app has no
    // `allowedNodeUrls` equivalent, so the stored node IS the anchor.
    if (!localStorage.getItem('node-url')) {
      localStorage.setItem('node-url', new URL(hashNodeUrl).origin);
    }
  } catch {
    // A malformed node_url or blocked storage just means no auto-login; the
    // Connect button still works.
  }
}

createRoot(document.getElementById('root')!).render(
  <AppWrapper>
    {/*
      PACKAGE-BASED, not `clientApplicationId`. Three things were wrong with the
      legacy pair and all three are fixed by this switch:

      1. HOSTED LOGIN WAS REFUSED. The auth frontend only hands minted tokens
         back to a callback origin it trusts, and for anything that is not
         loopback that means asking the registry whether this package declares
         that origin as its `links.frontend`. It reads the package from the
         `package-name` login param — which the client sends only in this
         variant. Without it the lookup has nothing to ask about and fails
         closed with exactly the reported error:

             Login callback destination is not allowed.

         Local and desktop-loopback login kept working, which is why this
         survived: only the deployed origin breaks, and only after credentials
         have already been accepted.

      2. THE BAKED APPLICATION ID WAS WRONG EVERYWHERE. An ApplicationId is
         assigned PER INSTALL, so `46M9ay…` was right only on the machine it was
         copied from; core answers a request naming an unknown application with
         an opaque 500. It was also base58, which core 0.11.0-rc.27 stopped
         using. The registry resolves the id per node instead.

      3. THE WASM CAME FROM AN S3 BUCKET. `applicationPath` pointed at
         `mero_sign_test_v1.wasm` on a dev S3 bucket — not the published bundle,
         and not something this repo builds. The registry serves the real one.
    */}
    <CalimeroProvider
      packageName={PACKAGE_NAME}
      registryUrl={REGISTRY_URL}
      mode={AppMode.MultiContext}
    >
      <App />
    </CalimeroProvider>
  </AppWrapper>,
);


