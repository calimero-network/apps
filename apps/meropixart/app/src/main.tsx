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
import "./index.css";

// ── Tauri desktop SSO: read auth tokens from the URL hash before React mounts ──
//
// On the web, MeroPixArt goes through the node's real auth flow (ConnectButton
// → /auth/login redirect → callback hash, which MeroProvider consumes itself).
// We must NOT pre-process the hash there or it races MeroProvider.
//
// Only the Tauri desktop skips auth: tauri-app opens a window like
//   meropixart://…#node_url=…&access_token=…&refresh_token=…
//                 &application_id=…&context_id=…&expires_at=…
const IS_TAURI = "__TAURI_INTERNALS__" in window;

function persistTauriHashAuth() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;

  const p = new URLSearchParams(hash);
  const nodeUrl = p.get("node_url")?.trim();
  const accessToken = p.get("access_token");
  const refreshToken = p.get("refresh_token");
  const applicationId = (p.get("application_id") ?? p.get("app-id") ?? "").trim();
  const contextId = p.get("context_id");
  const expiresAt = p.get("expires_at");

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

  const targetPath = contextId ? `/teams/t/projects/${contextId}` : "/teams";
  window.history.replaceState({}, "", targetPath);
}

if (IS_TAURI) persistTauriHashAuth();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MeroProvider
      mode={MeroAppMode.MultiContext}
      packageName={import.meta.env.VITE_APPLICATION_PACKAGE ?? "com.calimero.meropixart"}
      registryUrl="https://apps.calimero.network"
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MeroProvider>
  </StrictMode>,
);
