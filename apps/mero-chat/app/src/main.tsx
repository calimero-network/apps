import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";
import { decodeInvitationPayload, INVITATION_STORAGE_KEY } from "./utils/invitation.ts";
import {
  MeroProvider,
  AppMode as MeroAppMode,
  getNodeUrl,
  setNodeUrl,
} from "@calimero-network/mero-react";
import MeroJsBridge from "./api/MeroJsBridge.tsx";
import {
  TOKENS_KEY,
  jwtExpiryMs,
  readStoredTokens,
  shouldSeedTokens,
} from "./utils/authTokens.ts";
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

// Session-specific keys that become stale across SSO opens and must be
// cleared so the app starts fresh rather than navigating into old state.
const SESSION_STALE_KEYS = [
  "calimero_group_id",
  "calimero_group_member_identities",
  "calimero_context_member_identities",
  "lastSession",
];

function clearStaleSessionData() {
  for (const key of SESSION_STALE_KEYS) {
    localStorage.removeItem(key);
  }
  // Clear dynamic sessionLastActivity_* keys
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("sessionLastActivity")) toRemove.push(k);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}

// Tauri SSO and web-auth callbacks deliver tokens via URL hash. MeroProvider's
// internal `LocalStorageTokenStore()` reads tokens as a single JSON blob at
// `mero-tokens`; seed the hash values there before React mounts (effects would
// be too late).
//
// The stored bundle deliberately WINS over the hash unless the hash is genuinely
// newer — see `shouldSeedTokens` (utils/authTokens.ts) for why clobbering it
// gets the whole token family revoked under single-use refresh (core#3083).
function persistAuthHashOnLoad(): void {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  const p = new URLSearchParams(hash);
  const accessToken = p.get("access_token");
  const refreshToken = p.get("refresh_token");
  const expiresAt = p.get("expires_at");
  const nodeUrl = p.get("node_url")?.trim();

  // Read the node we were last pointed at BEFORE setNodeUrl overwrites it —
  // a different node means the stored bundle belongs to a foreign token family.
  const previousNodeUrl = getNodeUrl();
  if (nodeUrl) setNodeUrl(nodeUrl);
  if (!accessToken || !refreshToken) return;

  const hashExpiresAtMs =
    jwtExpiryMs(accessToken) ??
    (expiresAt ? parseInt(expiresAt, 10) : Date.now() + 3600_000);

  const nodeChanged =
    !!nodeUrl && !!previousNodeUrl && previousNodeUrl.trim() !== nodeUrl;

  const seed = shouldSeedTokens({
    hashExpiresAtMs,
    stored: readStoredTokens(),
    nodeChanged,
  });

  if (seed) {
    // Clear stale session data before writing new tokens — prevents the app
    // from loading into a stale group/context from a previous SSO session.
    // Only on a genuinely new session: re-opening the current one must not
    // nuke the navigation state out from under a live tab.
    clearStaleSessionData();
    localStorage.setItem(
      TOKENS_KEY,
      JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: hashExpiresAtMs,
      }),
    );
  }

  // Remove the hash either way, so MeroProvider's parseAuthCallback doesn't
  // re-process the original tokens and overwrite the (possibly rotated) bundle.
  window.history.replaceState(
    {},
    "",
    window.location.pathname + window.location.search,
  );
}

// Extract ?invitation= from URL before React mounts — React Router's <Navigate>
// runs its useEffect before parent component effects (children fire first), so
// the URL is already changed to /login before App.tsx can read it.
// Uses decodeInvitationPayload which handles deflate-compressed base58 (new),
// uncompressed base58, base64url, and percent-encoded JSON (all legacy).
(function extractInvitationOnLoad() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("invitation");
    if (!raw) return;
    const decoded = decodeInvitationPayload(raw);
    if (decoded) localStorage.setItem(INVITATION_STORAGE_KEY, decoded);
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

// Persist ONLY a URL-provided app-id (desktop SSO hash / explicit link).
// The VITE_APPLICATION_ID build default must never be written to storage:
// a misconfigured build env would poison the stored id for every later
// session, and getApplicationId() (constants/config.ts) reads the stored
// value ahead of the build defaults.
function getUrlApplicationId(): string {
  const fromSearch = new URLSearchParams(window.location.search).get("app-id")?.trim();
  if (fromSearch) return fromSearch;
  return new URLSearchParams(window.location.hash.slice(1)).get("app-id")?.trim() || "";
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
      .then(() => log.info("ServiceWorker", "Service worker registered successfully"))
      .catch((error) => log.error("ServiceWorker", "Service worker registration failed", error));
  });
}

const AppWrapper = import.meta.env.DEV ? StrictMode : React.Fragment;

function boot() {
  // Seed SSO tokens from the URL hash before React reads localStorage.
  //
  // There is deliberately NO proactive refresh here. mero-js refreshes
  // reactively on a 401 + `x-auth-error: token_expired`, behind a single-flight
  // mutex. A hand-rolled refresh alongside it would (a) be rejected outright
  // when the access token is still valid ("Access token still valid" — see
  // core#3083) and (b) race the SDK's own refresh over the same stored bundle,
  // so one of the two would present an already-consumed, single-use refresh
  // token → `token_reuse` → the entire token family is revoked.
  persistAuthHashOnLoad();

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
