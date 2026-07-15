import React from "react";
import ReactDOM from "react-dom/client";
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
import "./styles/theme.css";
import "./index.module.scss";
import { Provider as StoreProvider } from "react-redux";
import { store } from "./store/store";
import { ModalProvider } from "./providers/ModalProvider";
import { PopupProvider } from "./providers/PopupProvider";
import { ThemeProvider } from "./providers/ThemeProvider";

// ── Tauri desktop SSO: read auth tokens from the URL hash before React mounts ──
//
// On the web, Mero Calendar goes through the node's real auth flow
// (ConnectButton → /auth/login redirect → callback hash, which MeroProvider
// consumes itself). We must NOT pre-process the hash there or it races
// MeroProvider. Only the Tauri desktop skips auth: tauri-app opens a window with
//   merocalendar://…#node_url=…&access_token=…&refresh_token=…&application_id=…
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

  // Deep-link straight into the shared calendar when the desktop told us which
  // context to open (same as mero-design/mero-pixart). "t" is a placeholder
  // teamId — CalendarPage only needs contextId; teamId only drives the Back
  // button. Otherwise land on the teams list.
  const targetPath = contextId ? `/teams/t/calendar/${contextId}` : "/teams";
  window.history.replaceState({}, "", targetPath);
}

// mero-react ≥4.1 REJECTS SSO tokens whose node_url is not explicitly trusted
// (`allowedNodeUrls`) — they are dropped with only a console error and the app
// dead-ends unauthenticated. Desktop node URLs legitimately vary per user
// (everyone runs their own node), so the only workable trust anchor is the node
// the desktop itself handed us in THIS open's hash. Capture it before
// persistTauriHashAuth() strips the hash. On the plain web IS_TAURI is false, no
// hash node is ever trusted, and the check keeps protecting the real auth flow.
const tauriHashNodeUrl = IS_TAURI
  ? (new URLSearchParams(window.location.hash.slice(1)).get("node_url")?.trim() ?? null)
  : null;

if (IS_TAURI) persistTauriHashAuth();

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <MeroProvider
      mode={MeroAppMode.MultiContext}
      packageName={import.meta.env.VITE_APPLICATION_PACKAGE ?? "com.calimero.merocalendar"}
      registryUrl="https://apps.calimero.network"
      allowedNodeUrls={tauriHashNodeUrl ? [tauriHashNodeUrl] : undefined}
    >
      <ThemeProvider>
        <StoreProvider store={store}>
          <ModalProvider>
            <PopupProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </PopupProvider>
          </ModalProvider>
        </StoreProvider>
      </ThemeProvider>
    </MeroProvider>
  </React.StrictMode>,
);
