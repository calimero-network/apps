// ── Tauri desktop detection ───────────────────────────────────────────────────
//
// ⚠️ THIS APP IS WEB ONLY. The Calimero desktop is not a supported target — see
// "Platform support" in the app's README. What survives here is one thing: a
// Tauri global counts as a session signal, alongside `hasHashSession()` below.
// Neither is required for the app to run.
//
// The list below is kept as-is deliberately, and the comment that used to sit
// here was wrong about why. It claimed "tauri-app is built on **Tauri v1**
// (1.8)", so the v1 globals were "what tauri-app actually provides" and
// `__TAURI_INTERNALS__` was the forward-compat afterthought. It is the other way
// round: tauri-app is **Tauri v2** (`@tauri-apps/api ^2.11.1`,
// `tauri = { version = "2" }`) with `withGlobalTauri: false`, so an app window
// gets `__TAURI_INTERNALS__` and NONE of the three v1 names. The v1 entries are
// therefore dead, and detection works only because of the last line.
//
// That mattered: the `invokeTauri` helper this file used to export read
// `window.__TAURI_INVOKE__` and so always returned `null`, making its one
// caller-facing command (`closeWindow`) a silent no-op. Both have been removed
// rather than left looking functional — nothing in src/ called either, and even
// a correct v2 invoke would not have worked, because `close_current_window` is
// not among the commands tauri-app grants to `app-*` windows (see its
// `capabilities/remote.json`: `core:window:allow-close` plus the node proxy and
// token-broker commands, and nothing else).

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI_IPC__?: unknown;
    __TAURI__?: unknown;
    __TAURI_INVOKE__?: unknown;
  }
}

export const IS_TAURI =
  typeof window.__TAURI_INVOKE__ === "function" || // Tauri v1 — dead, see above
  "__TAURI_IPC__" in window || // Tauri v1 native IPC bridge — dead
  "__TAURI__" in window || // withGlobalTauri builds — tauri-app sets it false
  "__TAURI_INTERNALS__" in window; // Tauri v2 — the only one that ever matches

// ── Hash-handed browser session ───────────────────────────────────────────────
//
// A session (node URL + access token) can arrive in the URL hash rather than from
// the Tauri shell. Whoever opens the app supplies it: tauri-app's
// `openAppFrontend`, the apps-registry launcher, or `scripts/dev-invite.sh` for
// local two-node testing — all three build the SAME hash.
//
// This USED to be gated on `import.meta.env.DEV`, which meant a production build
// rendered the app ONLY inside Tauri. That made the deployed web build a dead
// landing page for every visitor, including one arriving from the desktop with a
// perfectly good hash. The gate predated the finding (PR #5) that web-only is
// sound for this app: node traffic is direct HTTP + SSE from the browser, there is
// no Tauri Rust proxy on any path, and auth is an ordinary bearer token. The
// desktop shell was never load-bearing, so the DEV restriction was gating on the
// wrong thing.
//
// It is still a real gate, not an open door: no hash means no node and no token,
// which renders the landing page. And mero-react only trusts the node_url handed
// in via this same hash (`allowedNodeUrls` in main.tsx), so an arbitrary origin
// cannot point the app at a node of its choosing.
function hasHashSession(): boolean {
  try {
    const p = new URLSearchParams(window.location.hash.slice(1));
    return Boolean(
      (p.get("node_url") ?? p.get("nodeUrl")) && p.get("access_token"),
    );
  } catch {
    return false;
  }
}

/**
 * Whether the full Mero Stream UI (capture/diagnostics) is allowed to render.
 * True inside the Tauri desktop shell, or whenever a session arrived in the URL
 * hash (see {@link hasHashSession}). With neither, we show the landing page.
 *
 * Evaluated once at module load — before MeroProvider parses and strips the auth
 * hash — so the detection still sees the hash.
 */
export const APP_ENABLED = IS_TAURI || hasHashSession();
