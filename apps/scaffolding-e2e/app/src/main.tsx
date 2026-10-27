import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  AppMode,
  MeroProvider,
  primeInvitationCapture,
  setApplicationId,
} from "@calimero-apps/cloud";
import { getNodeUrl, setNodeUrl } from "./lib/mero";
import "./index.css";
import App from "./App.tsx";
import { APP_SLUG } from "./lib/invite";

// An invitation reaches this app only as an opened link: the links page (or a
// cold desktop start) appends `?invitation=…` to this URL, and a running
// desktop sends a `deep-link` event. Captured before React mounts; a link
// addressed to another app is dropped, not offered.
primeInvitationCapture("scaffolding-e2e", { slug: APP_SLUG });

// Pick the cluster BEFORE React mounts.
(function bootstrapHashParams() {
  // ?node=<url> lets two browser tabs point to two different merod nodes without
  // changing .env. The param is preserved across reloads (we don't strip it).
  const searchNode = new URLSearchParams(window.location.search).get("node");
  if (searchNode) setNodeUrl(searchNode.trim());

  // Seed node URL from .env if nothing is stored yet.
  const envUrl = import.meta.env.VITE_NODE_URL?.trim();
  if (envUrl && !getNodeUrl()) {
    setNodeUrl(envUrl);
  }
  // v1's SSO hash (node_url, access_token, …) is gone: on Calimero Cloud a
  // person signs in with a passkey in the page.
})();

// Must match [package.metadata.calimero] package in logic/Cargo.toml — the
// registry resolves an ApplicationId from it. Falling back to it (rather than to
// "", which resolves to nothing and leaves the app wedged after login) is what
// lets the hosted build run with no env vars configured at all.
const DEFAULT_PACKAGE = "com.calimero.scaffolding-e2e";

// Mode 1: direct app ID — set VITE_APP_ID in .env for an app already installed on
//          the node (`meroctl app install`). Local-only: the id differs per install.
//          (The previous SDK could also point the node at a served `app.wasm` to
//          install it; MeroProvider has no equivalent, so the app must already be
//          installed for this mode.)
// Mode 2: package name — set VITE_APPLICATION_PACKAGE in .env, or leave it unset
//          to get DEFAULT_PACKAGE. Auth frontend resolves the app ID from the
//          node's installed packages or the Calimero registry.
// VITE_APP_ID takes priority if both are set.
const appId = import.meta.env.VITE_APP_ID?.trim();
const packageName = import.meta.env.VITE_APPLICATION_PACKAGE?.trim();

// VITE_APP_ID pins an already-installed application id; otherwise the package
// name is resolved through the registry. `setApplicationId` rather than a provider
// prop, because MeroProvider takes the package and looks the id up itself.
if (appId) setApplicationId(appId);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <MeroProvider
        mode={AppMode.MultiContext}
        packageName={packageName || DEFAULT_PACKAGE}
        registryUrl="https://apps.calimero.network"
      >
        <App />
      </MeroProvider>
    </BrowserRouter>
  </StrictMode>,
);
