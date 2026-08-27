import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  MeroProvider,
  AppMode as MeroAppMode,
  setApplicationId,
} from "@calimero-network/mero-react";
import "@calimero-network/mero-ui/styles.css";

import App from "./App";
import { primeInvitationCapture } from "./utils/invitationIntents";
import "./styles/theme.css";
import "./index.module.scss";
import { Provider as StoreProvider } from "react-redux";
import { store } from "./store/store";
import { ModalProvider } from "./providers/ModalProvider";
import { PopupProvider } from "./providers/PopupProvider";
import { ThemeProvider } from "./providers/ThemeProvider";

// ── Inbound invitation links ──────────────────────────────────────────────────
//
// Must run before React mounts: the launcher opens this app by appending
// `?invitation=…` to its own frontend URL, and Router replaces the URL on the
// first navigation — child effects fire before parent effects, so there is no
// component early enough to read it reliably. Capture is durable, so an
// invitation arriving before login survives the auth round-trip.
primeInvitationCapture();

// ── Tauri desktop SSO ─────────────────────────────────────────────────────────
//
// tauri-app opens this app in a window with auth + calendar context in the hash:
//   merocalendar://…#node_url=…&access_token=…&refresh_token=…&application_id=…
//
// The tokens are MeroProvider's business, NOT ours. It runs `parseAuthCallback`
// on first render and decides whether to adopt the hash bundle via
// `resolveTokenAdoption` (mero-react ≥4.3.4), which is strictly better than
// doing it here: it compares `iat` — the actual rotation order — where a
// hand-rolled version only has `exp`, and it merges rather than replaces so an
// access-only hash cannot strip a live refresh token.
//
// This matters because refresh tokens are single-use (core#3083). The desktop
// hands us the bundle it minted at *its* login, routinely OLDER than the one
// mero-js has since rotated into storage. Adopting the stale one re-presents a
// consumed refresh token on the next 401 → `token_reuse` → the whole token
// family is revoked and every holder is hard-logged-out. This file used to seed
// the store itself and then strip the hash, so MeroProvider never saw the
// callback and its better check never ran.
//
// So: read only what is ours — the application id and the calendar to open —
// and leave the hash in place for MeroProvider.
const IS_TAURI = "__TAURI_INTERNALS__" in window;

function readTauriHashContext() {
  const hash = window.location.hash;
  if (!hash) return;

  const p = new URLSearchParams(hash.slice(1));
  const applicationId = (p.get("application_id") ?? p.get("app-id") ?? "").trim();
  const contextId = p.get("context_id");

  if (applicationId) setApplicationId(applicationId);

  // Deep-link into the specific project/calendar when the desktop said which to
  // open ("t" is a placeholder teamId — only the Back button uses it).
  //
  // Always land on the app's own route, exactly as before — the desktop opens
  // this window at `/`, and without this the user sits on the landing route.
  //
  // The hash is APPENDED, not dropped: MeroProvider has not read it yet and it
  // is the only copy of the auth callback. It strips the hash itself once it has
  // consumed it, which is what leaves the address bar clean.
  const target = contextId ? `/teams/t/calendar/${contextId}` : "/teams";
  window.history.replaceState({}, "", `${target}${hash}`);
}

// mero-react ≥4.1 REJECTS SSO tokens whose node_url is not explicitly trusted
// (`allowedNodeUrls`) — they are dropped with only a console error and the app
// dead-ends unauthenticated. Desktop node URLs legitimately vary per user
// (everyone runs their own node), so the only workable trust anchor is the node
// the desktop itself handed us in THIS open's hash. Capture it before
// MeroProvider consumes the hash. On the plain web IS_TAURI is false, no
// hash node is ever trusted, and the check keeps protecting the real auth flow.
const tauriHashNodeUrl = IS_TAURI
  ? (new URLSearchParams(window.location.hash.slice(1)).get("node_url")?.trim() ?? null)
  : null;

if (IS_TAURI) readTauriHashContext();

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
