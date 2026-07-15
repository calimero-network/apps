import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  MeroProvider,
  AppMode as MeroAppMode,
  getNodeUrl,
  setNodeUrl,
  setApplicationId,
} from "@calimero-network/mero-react";
import "@calimero-network/mero-ui/styles.css";
import App from "./App";
import {
  TOKENS_KEY,
  jwtExpiryMs,
  readStoredTokens,
  shouldSeedTokens,
} from "./utils/authTokens";
import "./index.css";

// ── Tauri desktop SSO: read auth tokens from the URL hash before React mounts ──
//
// On the web, MeroDesign goes through the node's real auth flow (ConnectButton
// → /auth/login redirect → callback hash, which MeroProvider consumes itself).
// We must NOT pre-process the hash there or it races MeroProvider.
//
// Only the Tauri desktop skips auth: tauri-app opens a window like
//   merodesign://…#node_url=…&access_token=…&refresh_token=…
//                 &application_id=…&context_id=…&expires_at=…
// (older builds use `app-id` instead of `application_id` — we tolerate both).
// We seed those into the mero token store so MeroProvider sees an authenticated
// session on first render, then strip the hash.
//
// The stored bundle deliberately WINS over the hash unless the hash is genuinely
// newer — see `shouldSeedTokens` (utils/authTokens.ts) for why clobbering it gets
// the whole token family revoked under single-use refresh (core#3083).
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

  // Read the node we were last pointed at BEFORE setNodeUrl overwrites it — a
  // different node means the stored bundle belongs to a foreign token family.
  const previousNodeUrl = getNodeUrl();

  setNodeUrl(nodeUrl);
  if (applicationId) setApplicationId(applicationId);

  const hashExpiresAtMs =
    jwtExpiryMs(accessToken) ??
    (expiresAt ? parseInt(expiresAt, 10) : Date.now() + 3600_000);

  const seed = shouldSeedTokens({
    hashExpiresAtMs,
    stored: readStoredTokens(),
    nodeChanged: !!previousNodeUrl && previousNodeUrl.trim() !== nodeUrl,
  });

  if (seed) {
    localStorage.setItem(
      TOKENS_KEY,
      JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: hashExpiresAtMs,
      }),
    );
  }

  // Navigate to the specific canvas if tauri told us which project to open.
  // "t" is a placeholder teamId — CanvasPage only needs projectId; teamId is
  // only used by the Back button. Also strips the hash before React Router reads it.
  const targetPath = contextId ? `/teams/t/projects/${contextId}` : "/teams";
  window.history.replaceState({}, "", targetPath);
}

if (IS_TAURI) persistTauriHashAuth();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MeroProvider
      mode={MeroAppMode.MultiContext}
      packageName={import.meta.env.VITE_APPLICATION_PACKAGE ?? "com.calimero.merodesign"}
      registryUrl="https://apps.calimero.network"
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MeroProvider>
  </StrictMode>,
);
