import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  MeroProvider,
  AppMode as MeroAppMode,
  setApplicationId,
} from "@calimero-network/mero-react";
import "@calimero-network/mero-ui/styles.css";
import App from "./App";
import { primeInvitationCapture } from "./utils/invitationIntents";
import "./index.css";

// ── Inbound invitation links ──────────────────────────────────────────────────
//
// Must run before React mounts: the launcher opens this app by appending
// `?invitation=…` to its own frontend URL, and React Router replaces the URL on
// the first navigation — child effects fire before parent effects, so there is
// no component early enough to read it reliably. Capture is durable, so an
// invitation that arrives before login survives the auth round-trip.
primeInvitationCapture();

// ── Tauri desktop SSO ─────────────────────────────────────────────────────────
//
// tauri-app opens this app in a window with auth + project context in the hash:
//   …#node_url=…&access_token=…&refresh_token=…
//     &application_id=…&context_id=…&expires_at=…
// (older builds use `app-id` instead of `application_id` — both tolerated).
//
// The tokens themselves are MeroProvider's business, NOT ours. It runs
// `parseAuthCallback` on first render and decides whether to adopt the hash
// bundle via `resolveTokenAdoption` (mero-react ≥4.3.4), which is strictly
// better than doing it here: it compares `iat` — the actual rotation order —
// where a hand-rolled version only has `exp` to go on, and it merges rather than
// replaces so an access-only hash cannot strip a live refresh token.
//
// This matters because refresh tokens are single-use (core#3083). The desktop
// hands us the bundle it minted at *its* login, which is routinely OLDER than
// the one mero-js has since rotated into storage. Adopting the stale one
// re-presents a consumed refresh token on the next 401 → `token_reuse` → the
// whole token family is revoked and every holder is hard-logged-out. This file
// used to seed the store itself and then strip the hash, which meant
// MeroProvider never saw the callback and its better check never ran.
//
// So: read only what is ours (the application id and the project to open), and
// leave the hash in place for MeroProvider.
const IS_TAURI = "__TAURI_INTERNALS__" in window;

/** The node the desktop handed us in this open, or null on the plain web. */
function hashNodeUrl(): string | null {
  if (!IS_TAURI) return null;
  const raw = new URLSearchParams(window.location.hash.slice(1))
    .get("node_url")
    ?.trim();
  return raw ? raw : null;
}

function readTauriHashContext(): void {
  const hash = window.location.hash;
  if (!hash) return;

  const p = new URLSearchParams(hash.slice(1));
  const applicationId = (
    p.get("application_id") ??
    p.get("app-id") ??
    ""
  ).trim();
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
  const target = contextId ? `/teams/t/projects/${contextId}` : "/teams";
  window.history.replaceState({}, "", `${target}${hash}`);
}

if (IS_TAURI) readTauriHashContext();

// mero-react ≥4.1 REJECTS an SSO callback whose node_url is not explicitly
// trusted (`allowedNodeUrls`), dropping the tokens with only a console error.
// Our node_url legitimately varies per user (everyone runs their own node), so
// the only workable trust anchor is the node the desktop handed us in THIS
// open's hash. Read before MeroProvider strips it. Mirrors mero-stream.
const trustedNodeUrl = hashNodeUrl();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MeroProvider
      mode={MeroAppMode.MultiContext}
      packageName={
        import.meta.env.VITE_APPLICATION_PACKAGE ?? "com.calimero.meropixart"
      }
      registryUrl="https://apps.calimero.network"
      allowedNodeUrls={trustedNodeUrl ? [trustedNodeUrl] : undefined}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MeroProvider>
  </StrictMode>,
);
