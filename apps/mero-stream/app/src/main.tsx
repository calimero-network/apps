import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  MeroProvider,
  AppMode as MeroAppMode,
} from "@calimero-network/mero-react";
import "@calimero-network/mero-ui/styles.css";
import App from "./App";
import { APP_ENABLED } from "./lib/tauri";
import { captureSessionFromHash } from "./lib/session";
import "./index.css";

// ── Tauri desktop SSO ─────────────────────────────────────────────────────────
//
// tauri-app opens this app in a WebviewWindow with auth + stream context in the
// URL hash (see tauri-app appUtils.ts `openAppFrontend`):
//
//   …#node_url=…&access_token=…&refresh_token=…
//     &app-id=…&context_id=…&executor_public_key=…&expires_at=…
//
// SSO is owned by MeroProvider, NOT us: on first render it runs
// `parseAuthCallback(window.location.href)`, reads `access_token` + `node_url`
// from this hash, stores them in mero-js's own token store, then strips the hash.
// We must therefore leave the hash INTACT — all we do here is capture Mero
// Stream's own context (context_id + executor_public_key + dev_mode) before
// MeroProvider strips it; those are read by name and never mutate location, so
// running first is safe. The plain web has no hash → no-op, and App renders the
// landing page (see App.tsx). Mirrors mero-meet's main.tsx.
if (APP_ENABLED) captureSessionFromHash();

// mero-react ≥4.1 REJECTS an SSO callback whose node_url is not explicitly
// trusted (`allowedNodeUrls`) — it drops the tokens with only a console error.
// Our node_url legitimately varies per user (everyone runs their own node), so
// the only workable trust anchor is the node the desktop handed us in THIS
// open's hash. Read it before MeroProvider strips the hash.
const hashNodeUrl = APP_ENABLED
  ? new URLSearchParams(window.location.hash.slice(1)).get("node_url")
  : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MeroProvider
      mode={MeroAppMode.MultiContext}
      packageName={
        import.meta.env.VITE_APPLICATION_PACKAGE ?? "com.calimero.merostream"
      }
      registryUrl="https://apps.calimero.network"
      allowedNodeUrls={hashNodeUrl ? [hashNodeUrl] : undefined}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MeroProvider>
  </StrictMode>,
);
