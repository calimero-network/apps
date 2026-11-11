import "@calimero-apps/glass/glass.css";
// The passkey styles also carry the "new version available" card
// (`watchUpgrades`), which shows on any page once signed in, not just /login.
import "@calimero-apps/passkey/passkey.css";
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";
import { SERVED_BY_NODE, nodeBasename } from "./utils/servedByNode";
import { NATIVE_CONSENT_CALLBACK, startCalimero } from "./api/calimero.ts";
import "@calimero-network/mero-ui/styles.css";
import { ToastProvider } from "@calimero-network/mero-ui";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { WebSocketProvider } from "./contexts/WebSocketContext.tsx";
import { log } from "./utils/logger.ts";
import { captureInvite } from "./utils/invitation.ts";
import { bounceNativeConsent, captureNativeApproval, captureNativeSignIn } from "@calimero-apps/passkey/native";
import { purgeLegacyIdentityDisplayNames } from "./utils/messengerName.ts";
import { applyTheme, readStoredTheme } from "./theme/theme.ts";

// index.html already set the theme before paint; this keeps the meta colour
// and attribute right if that inline script was skipped (e.g. a cached shell).
applyTheme(readStoredTheme());

// Single-global-name model: legacy `curb_username_<identity>` rows from
// older app versions are no longer read; clean them up once on startup so
// the localStorage stays small and predictable.
purgeLegacyIdentityDisplayNames();

import "react-photo-view/dist/react-photo-view.css";

// The node's consent page returning to the phone app (`?native-consent=1`):
// pass the answer on to the app and render nothing here.
const bounced = bounceNativeConsent(window.location, NATIVE_CONSENT_CALLBACK);

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-up. React
// Router's <Navigate> would replace the URL before any component could read it.
captureInvite();

// Opened by the iOS or Android app to sign in (`#native-sign-in&state=…&key=…`).
captureNativeSignIn();
// …or to approve a change with the passkey (`#native-approve&…`).
captureNativeApproval();

// One connection, on the target this build names: `merod local` under `vite`,
// the Calimero Cloud cluster in a production build (`@calimero-apps/connect`).
// The screens render at once and show the connecting state until it settles.
if (!bounced) void startCalimero();

// Register service worker for PWA (production only — sw.js is not served in dev)
// A node-served app shares one origin across versions, so no service worker there.
if ("serviceWorker" in navigator && !import.meta.env.DEV && !SERVED_BY_NODE) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then(() =>
        log.info("ServiceWorker", "Service worker registered successfully"),
      )
      .catch((error) =>
        log.error("ServiceWorker", "Service worker registration failed", error),
      );
  });
}

const AppWrapper = import.meta.env.DEV ? StrictMode : React.Fragment;

if (!bounced) createRoot(document.getElementById("root")!).render(
  <AppWrapper>
    <ErrorBoundary
      onError={(error, errorInfo) => {
        log.error("App", "Uncaught error in React tree", {
          error,
          errorInfo,
        });
      }}
    >
      <BrowserRouter basename={nodeBasename()}>
        <WebSocketProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </WebSocketProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </AppWrapper>,
);
