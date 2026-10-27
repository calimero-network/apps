import "@calimero-apps/glass/glass.css";
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";
import {
  MeroProvider,
  AppMode as MeroAppMode,
  primeInvitationCapture,
} from "@calimero-apps/cloud";
import MeroJsBridge from "./api/MeroJsBridge.tsx";
import { BLOB_READ_TIMEOUT_MS } from "./api/blobs.ts";
import "@calimero-network/mero-ui/styles.css";
import { ToastProvider } from "@calimero-network/mero-ui";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { WebSocketProvider } from "./contexts/WebSocketContext.tsx";
import { log } from "./utils/logger.ts";
import { APP_SLUG } from "./utils/invitation.ts";
import { applyDevOverlay } from "./utils/devOverlay.ts";
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

// An invitation reaches this app only as an opened link: the links page (or a
// cold desktop start) appends `?invitation=…` to this URL, and a running
// desktop sends a `deep-link` event. Capture both BEFORE React mounts: React
// Router's <Navigate> replaces the URL with /login before any component effect
// could read the query, and on a cold open the user is not signed in yet.
//
// The intent is persisted in the platform SDK's pending-intent store
// (`calimero.platform.pendingIntents`, preserved across the Connect wipe — see
// CONNECT_PRESERVE_EXACT in pages/Login) and offered by the app-level
// `InvitationPrompt` once the session can join. A link addressed to another
// app is dropped, not offered.
primeInvitationCapture("mero-chat", { slug: APP_SLUG });

const CALIMERO_APP_ID_KEY = "calimero-application-id";

// Persist ONLY a URL-provided app-id (desktop SSO hash / explicit link).
// The VITE_APPLICATION_ID build default must never be written to storage:
// a misconfigured build env would poison the stored id for every later
// session, and getApplicationId() (constants/config.ts) reads the stored
// value ahead of the build defaults.
function getUrlApplicationId(): string {
  const fromSearch = new URLSearchParams(window.location.search)
    .get("app-id")
    ?.trim();
  if (fromSearch) return fromSearch;
  const hash = new URLSearchParams(window.location.hash.slice(1));
  return hash.get("app-id")?.trim() || hash.get("application_id")?.trim() || "";
}

const urlApplicationId = getUrlApplicationId();
// Always overwrite — hash app-id must win over any stale value from a previous session.
if (urlApplicationId) {
  localStorage.setItem(CALIMERO_APP_ID_KEY, urlApplicationId);
}

// Dev-only: when running under `make start`, dev-invite.sh writes
// /dev-overlay.json with namespace_id + namespace_alias. The webapp
// can't get the alias from /admin-api/namespaces on node-2 because
// rc.35 governance doesn't propagate the alias field. Seed the local
// alias cache so node-2's UI shows "Dev Workspace" instead of
// "Workspace {short-id}". See needs-fix.md item A2.
if (import.meta.env.DEV) {
  void applyDevOverlay();
}

// Register service worker for PWA (production only — sw.js is not served in dev)
if ("serviceWorker" in navigator && !import.meta.env.DEV) {
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

function boot() {
  createRoot(document.getElementById("root")!).render(
    <AppWrapper>
      <ErrorBoundary
        onError={(error, errorInfo) => {
          log.error("App", "Uncaught error in React tree", {
            error,
            errorInfo,
          });
        }}
      >
        <MeroProvider
          mode={MeroAppMode.MultiContext}
          // The package name is what lets hosted login trust this origin: the
          // node's auth page hands tokens only to loopback, itself, or the
          // `links.frontend` the registry declares for the NAMED package. With
          // no name it cannot look that up and refuses every web login with
          // "Login callback destination is not allowed" (desktop still works,
          // loopback is always trusted). Production shipped `packageName:""`
          // because Vercel's VITE_APPLICATION_PACKAGE was empty, so the env
          // var is only an override now, never the source.
          packageName={import.meta.env.VITE_APPLICATION_PACKAGE || APP_SLUG}
          registryUrl="https://apps.calimero.network"
          // 35s, not MeroProvider's 30s default.
          //
          // This is the client budget for EVERY mero-js call, and the one that
          // matters is a blob read: since rc.39 a blob a peer holds is found by
          // probing the context, and core bounds that sweep at ~30s with the
          // byte transfer on top. The default is therefore exactly the deadline
          // — the client aborts at the moment core is finishing, so a
          // cross-node image load fails roughly whenever discovery actually had
          // work to do, and looks like flake. mero-js has no per-call timeout
          // on `getBlob`, so this is the only place to set it.
          timeoutMs={BLOB_READ_TIMEOUT_MS}
        >
          <MeroJsBridge>
            <BrowserRouter>
              <WebSocketProvider>
                <ToastProvider>
                  <App />
                </ToastProvider>
              </WebSocketProvider>
            </BrowserRouter>
          </MeroJsBridge>
        </MeroProvider>
      </ErrorBoundary>
    </AppWrapper>,
  );
}

boot();
