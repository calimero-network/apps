// ── Tauri desktop detection ───────────────────────────────────────────────────
//
// Mero Meet is desktop-only. The Calimero node, auth/SSO, and (optionally) a
// bundled TURN relay are provided by tauri-app. On the plain web none of that
// exists, so we render a "open in the desktop app" landing page instead of the
// call UI.
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

// ── Dev-only browser harness ──────────────────────────────────────────────────
//
// Mero Meet is desktop-only in production, but a real video call needs TWO
// context members, which a single desktop instance can't provide on one laptop.
// For solo testing we run two local nodes and point two browser profiles at
// them — see scripts/dev-node*.sh + DEV-TESTING.md. The desktop normally hands
// the node + auth + room in via the URL hash; the harness builds the exact same
// hash by hand, so when one is present we let the full app run in a plain
// browser. Gated on import.meta.env.DEV so it can NEVER be true in a prod build.
function hasDevSession(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    const p = new URLSearchParams(window.location.hash.slice(1));
    return Boolean((p.get("node_url") ?? p.get("nodeUrl")) && p.get("access_token"));
  } catch {
    return false;
  }
}

/**
 * Whether the full Mero Meet UI (lobby/call) is allowed to render. True inside
 * the Tauri desktop shell, or in a dev browser session (see {@link hasDevSession}).
 * Everywhere else we show the "open in the desktop app" landing page.
 *
 * Evaluated once at module load — before MeroProvider parses and strips the
 * auth hash — so the dev-session detection still sees the hash.
 */
export const APP_ENABLED = IS_TAURI || hasDevSession();

/**
 * Invoke a Tauri Rust command if running inside the desktop shell.
 *
 * Used by the optional native-WebRTC bridge (see the tauri-app PR). When the
 * native command surface isn't present — e.g. running the webview before the
 * Rust side ships, or in a unit test — this resolves to `null` so callers can
 * gracefully fall back to the in-webview WebRTC engine.
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

/** Ask tauri-app to close this window (used by the "leave" / error flows). */
export async function closeWindow(): Promise<void> {
  await invokeTauri("close_current_window");
}
