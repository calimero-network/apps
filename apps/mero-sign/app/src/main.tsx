import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
// ⚠️ MeroProvider, not CalimeroProvider. `calimero-client` ships its own
// hardcoded connect screen ("Select your Calimero node type to continue… Using
// default local node: http://node1.127.0.0.1.nip.io") with no prop that removes
// it, and that screen is what `useCalimero().login()` opened. Mero Sign was the
// last app in this repo still on it. See `lib/useCalimero`.
import { AppMode, MeroProvider } from '@calimero-network/mero-react';
import { LoginGate } from './lib/loginGate';
import { MeroBridge } from './lib/MeroBridge';
import { PACKAGE_NAME, REGISTRY_URL } from './constants/config';
import { primeInvitationCapture as startInvitationCapture } from "@calimero-apps/invite";
import { bootstrapDesktopSession, hashNodeUrl } from './auth/desktopBootstrap';

// Disable StrictMode in production to avoid double-rendering
// which can cause 429 errors from CalimeroProvider's auth checks
const AppWrapper = import.meta.env.DEV ? StrictMode : React.Fragment;

// ── Desktop auth-skip ─────────────────────────────────────────────────────────
//
// The launcher opens an app at its registry `links.frontend` with the session
// already in the URL fragment. Seeded at module scope, before the provider's
// first render consumes and strips it. See `auth/desktopBootstrap`.
//
// ⚠️ WHAT WAS HERE HAD NEVER WORKED. It wrote the node to
// `localStorage['node-url']`, and `calimero-client` reads `app-url` —
// JSON-encoded. `node-url` occurs exactly once in that SDK's bundle, as the
// placeholder text of an input box. So the handed-over node was written to a key
// nothing reads, the application id was never seeded at all, and the desktop
// "skip" silently degraded to the ordinary connect screen.
bootstrapDesktopSession();

// Read before React mounts — `MeroProvider` consumes the prop on its first
// render and strips the fragment itself. See `hashNodeUrl`.
const trustedNodeUrl = hashNodeUrl();

// ── Invitations, captured before anything renders ─────────────────────────────
//
// An invitation link is a capability sitting in the URL, and the URL does not
// survive the login redirect. Capturing here — at module scope, before React and
// before `<CalimeroProvider>` decides to send a signed-out visitor to the auth
// frontend — puts the intent in the platform's durable store first, so it is
// still there when they come back logged in. `App.tsx` subscribes and shows the
// prompt; see `lib/invitationIntents.ts`.
startInvitationCapture("mero-sign");

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
    <MeroProvider
      packageName={PACKAGE_NAME}
      registryUrl={REGISTRY_URL}
      mode={AppMode.MultiContext}
      // ⚠️ Node trust is DEFAULT-DENY in mero-react. Without this a cold
      // desktop open rejects the session it was just handed and drops the
      // tokens with only a console error.
      allowedNodeUrls={trustedNodeUrl ? [trustedNodeUrl] : undefined}
    >
      <MeroBridge />
      <LoginGate>
        <App />
      </LoginGate>
    </MeroProvider>
  </AppWrapper>,
);
