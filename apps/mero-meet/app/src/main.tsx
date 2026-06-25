import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  MeroProvider,
  AppMode as MeroAppMode,
  setNodeUrl,
  setApplicationId,
} from "@calimero-network/mero-react";
import "@calimero-network/mero-ui/styles.css";
import App from "./App";
import { IS_TAURI } from "./lib/tauri";
import { captureSessionFromHash, setSession } from "./lib/session";
import "./index.css";

// ── Tauri desktop SSO ─────────────────────────────────────────────────────────
//
// tauri-app opens this app in a WebviewWindow with auth + room context in the
// URL hash (see tauri-app appUtils.ts `openAppFrontend`):
//
//   meromeet://…#node_url=…&access_token=…&refresh_token=…
//                &application_id=…&context_id=…&executor_public_key=…&expires_at=…
//
// We write the tokens straight into the mero token store so MeroProvider sees an
// authenticated session on first render, capture the room (context) + identity,
// then strip the hash. The plain web never has this hash → App renders the
// landing page instead (see App.tsx / IS_TAURI).
function persistTauriHashAuth() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  const p = new URLSearchParams(hash);

  const nodeUrl = p.get("node_url")?.trim();
  const accessToken = p.get("access_token");
  const refreshToken = p.get("refresh_token");
  const applicationId = (p.get("application_id") ?? p.get("app-id") ?? "").trim();
  const contextId = p.get("context_id") ?? "";
  const executor = p.get("executor_public_key") ?? "";
  const expiresAt = p.get("expires_at");

  // Capture the room + identity for the app regardless of token presence.
  captureSessionFromHash();
  if (contextId && executor) setSession(contextId, executor);

  if (!nodeUrl || !accessToken || !refreshToken) return;

  setNodeUrl(nodeUrl);
  if (applicationId) setApplicationId(applicationId);
  localStorage.setItem(
    "mero-tokens",
    JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt ? parseInt(expiresAt, 10) : Date.now() + 3600_000,
    }),
  );

  // Strip the hash and route to the lobby.
  window.history.replaceState({}, "", "/lobby");
}

if (IS_TAURI) persistTauriHashAuth();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MeroProvider
      mode={MeroAppMode.MultiContext}
      packageName={import.meta.env.VITE_APPLICATION_PACKAGE ?? "network.calimero.meromeet"}
      registryUrl="https://apps.calimero.network"
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MeroProvider>
  </StrictMode>,
);
