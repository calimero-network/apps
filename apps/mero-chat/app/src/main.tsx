import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";
import bs58 from "bs58";
import {
  MeroProvider,
  AppMode as MeroAppMode,
  setNodeUrl,
} from "@calimero-network/mero-react";
import "@calimero-network/mero-ui/styles.css";
import { ToastProvider } from "@calimero-network/mero-ui";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { WebSocketProvider } from "./contexts/WebSocketContext.tsx";
import { log } from "./utils/logger.ts";
import { applyDevOverlay } from "./utils/devOverlay.ts";
import { purgeLegacyIdentityDisplayNames } from "./utils/messengerName.ts";

// Single-global-name model: legacy `curb_username_<identity>` rows from
// older app versions are no longer read; clean them up once on startup so
// the localStorage stays small and predictable.
purgeLegacyIdentityDisplayNames();

import 'react-photo-view/dist/react-photo-view.css';

// Tauri SSO and web-auth callbacks deliver fresh tokens via URL hash.
// MeroProvider's internal `LocalStorageTokenStore()` reads tokens as a
// single JSON blob at `mero-tokens`; persist the hash values there before
// React mounts (effects would be too late).
(function persistAuthHashOnLoad() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  const p = new URLSearchParams(hash);
  const accessToken = p.get("access_token");
  const refreshToken = p.get("refresh_token");
  const expiresAt = p.get("expires_at");
  const nodeUrl = p.get("node_url");
  if (nodeUrl) setNodeUrl(nodeUrl.trim());
  if (accessToken && refreshToken) {
    localStorage.setItem(
      "mero-tokens",
      JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt ? parseInt(expiresAt, 10) : Date.now() + 3600_000,
      }),
    );
  }
})();

// Extract ?invitation= from URL before React mounts — React Router's <Navigate>
// runs its useEffect before parent component effects (children fire first), so
// the URL is already changed to /login before App.tsx can read it.
(function extractInvitationOnLoad() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("invitation");
    if (!raw) return;
    const trimmed = raw.trim();
    let decoded: string | undefined;

    // Try base58 first (new format)
    if (/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(trimmed)) {
      try {
        decoded = new TextDecoder().decode(bs58.decode(trimmed));
      } catch { /* fall through */ }
    }

    // Legacy: base64url
    if (!decoded && /^[A-Za-z0-9_-]+$/.test(trimmed)) {
      try {
        const base64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
        const pad = base64.length % 4;
        const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
        decoded = decodeURIComponent(escape(atob(padded)));
      } catch { /* fall through */ }
    }

    // Legacy: percent-encoded JSON
    if (!decoded) {
      try { decoded = decodeURIComponent(trimmed); } catch { return; }
    }

    if (decoded) localStorage.setItem("curb-invitation-payload", decoded);
    params.delete("invitation");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? "?" + qs : "") + window.location.hash,
    );
  } catch { /* ignore */ }
})();

const CALIMERO_APP_ID_KEY = "calimero-application-id";

function getExplicitApplicationId(): string {
  const fromSearch = new URLSearchParams(window.location.search).get("app-id")?.trim();
  if (fromSearch) return fromSearch;
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("app-id")?.trim();
  if (fromHash) return fromHash;
  return (import.meta.env.VITE_APPLICATION_ID as string | undefined)?.trim() || "";
}

const explicitApplicationId = getExplicitApplicationId();
if (explicitApplicationId && !localStorage.getItem(CALIMERO_APP_ID_KEY)) {
  localStorage.setItem(CALIMERO_APP_ID_KEY, explicitApplicationId);
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
      .then(() => log.info("ServiceWorker", "Service worker registered successfully"))
      .catch((error) => log.error("ServiceWorker", "Service worker registration failed", error));
  });
}

const AppWrapper = import.meta.env.DEV ? StrictMode : React.Fragment;

createRoot(document.getElementById("root")!).render(
  <AppWrapper>
    <ErrorBoundary
      onError={(error, errorInfo) => {
        log.error("App", "Uncaught error in React tree", { error, errorInfo });
      }}
    >
      <MeroProvider
        mode={MeroAppMode.MultiContext}
        packageName={import.meta.env.VITE_APPLICATION_PACKAGE}
        registryUrl="https://apps.calimero.network"
      >
        <BrowserRouter>
          <WebSocketProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </WebSocketProvider>
        </BrowserRouter>
      </MeroProvider>
    </ErrorBoundary>
  </AppWrapper>,
);
