import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MeroProvider, AppMode as MeroAppMode } from "@calimero-network/mero-react";
import "@calimero-network/mero-ui/styles.css";
import App from "./App";
import { APP_ENABLED } from "./lib/tauri";
import { captureSessionFromHash } from "./lib/session";
import "./index.css";

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MeroProvider
      mode={MeroAppMode.MultiContext}
      packageName={import.meta.env.VITE_APPLICATION_PACKAGE ?? "com.calimero.meromeet"}
      registryUrl="https://apps.calimero.network"
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MeroProvider>
  </StrictMode>,
);
