// ── Tauri desktop detection ───────────────────────────────────────────────────
//
// Detects the desktop shell, which supplies a node + auth/SSO implicitly. It is
// one of two ways the app can get a session — see `hasHashSession` below for the
// other — and NOT a requirement for the app to run.
//
// tauri-app is built on **Tauri v1** (1.8): its webview injects
// `window.__TAURI_INVOKE__` / `window.__TAURI_IPC__` — NOT the v2-only
// `__TAURI_INTERNALS__`. Detecting only `__TAURI_INTERNALS__` therefore made
// IS_TAURI always false inside the desktop shell, so the app fell through to the
// landing page and never ran the hash-auth SSO step. Check the v1 globals first
// (what tauri-app actually provides), keep the v2 ones for forward-compat.

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI_IPC__?: unknown;
    __TAURI__?: unknown;
    __TAURI_INVOKE__?: (cmd: string, args?: unknown) => Promise<unknown>;
  }
}

export const IS_TAURI =
  typeof window.__TAURI_INVOKE__ === "function" || // Tauri v1 (tauri-app 1.8)
  "__TAURI_IPC__" in window || // Tauri v1 native IPC bridge
  "__TAURI__" in window || // withGlobalTauri builds
  "__TAURI_INTERNALS__" in window; // Tauri v2 (forward-compat)

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

/**
 * Invoke a Tauri Rust command if running inside the desktop shell. When the
 * command surface isn't present (running the webview before the Rust side ships,
 * or in a unit test) this resolves to `null` so callers can gracefully fall back.
 */
export async function invokeTauri<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  const invoke = window.__TAURI_INVOKE__;
  if (!invoke) return null;
  try {
    return (await invoke(cmd, args)) as T;
  } catch {
    return null;
  }
}

/** Ask tauri-app to close this window (used by the error / leave flows). */
export async function closeWindow(): Promise<void> {
  await invokeTauri("close_current_window");
}
