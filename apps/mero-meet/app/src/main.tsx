import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MeroProvider, AppMode as MeroAppMode } from "@calimero-network/mero-react";
import "@calimero-network/mero-ui/styles.css";
import App from "./App";
import { APP_ENABLED } from "./lib/tauri";
import { captureSessionFromHash } from "./lib/session";
import { initTheme } from "./lib/theme";
import "./index.css";

// Resolve the light/dark theme before first paint (avoids a flash of the wrong
// theme). Reads the persisted choice or the OS preference.
initTheme();

// ── Tauri desktop SSO ─────────────────────────────────────────────────────────
//
// tauri-app opens this app in a WebviewWindow with auth + room context in the
// URL hash (see tauri-app appUtils.ts `openAppFrontend`):
//
//   …#node_url=…&access_token=…&refresh_token=…
//     &app-id=…&context_id=…&executor_public_key=…&expires_at=…
//
// SSO is owned by MeroProvider, NOT us: on first render it runs
// `parseAuthCallback(window.location.href)`, reads `access_token` + `node_url`
// from this hash, stores them in mero-js's own token store, then strips the
// hash. We must therefore leave the hash INTACT — an earlier version pre-parsed
// it and wrote a `mero-tokens` blob (a key mero-react never reads) while
// stripping the hash, so MeroProvider saw no callback and auth never happened →
// the app bounced to the landing page.
//
// All we do here is capture Mero Meet's own room context (context_id +
// executor_public_key + dev_mode) before MeroProvider strips the hash; it reads
// those by name and never mutates location, so it's safe to run first. The plain
// web has no hash → no-op, and App renders the landing page (see App.tsx).
if (APP_ENABLED) captureSessionFromHash();

// mero-react ≥4.1 REJECTS an SSO callback whose node_url is not explicitly
// trusted (`allowedNodeUrls`) — it drops the tokens with only a console error,
// and the app dead-ends unauthenticated on the landing page. Our node_url
// legitimately varies per user (everyone runs their own node), so the only
// workable trust anchor is the node the desktop itself handed us in THIS
// open's hash. Read it before MeroProvider strips the hash. This restores the
// pre-4.1 desktop SSO behavior; the check still protects the plain-web build,
// where APP_ENABLED is false and no hash node is ever trusted.
const hashNodeUrl = APP_ENABLED
  ? new URLSearchParams(window.location.hash.slice(1)).get("node_url")
  : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MeroProvider
      mode={MeroAppMode.MultiContext}
      packageName={import.meta.env.VITE_APPLICATION_PACKAGE ?? "com.calimero.meromeet"}
      registryUrl="https://apps.calimero.network"
      allowedNodeUrls={hashNodeUrl ? [hashNodeUrl] : undefined}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MeroProvider>
  </StrictMode>,
);
