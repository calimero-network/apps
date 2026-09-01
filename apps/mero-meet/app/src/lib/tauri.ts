// ── Tauri desktop detection ───────────────────────────────────────────────────
//
// Mero Meet is desktop-only. The Calimero node, auth/SSO, and (optionally) a
// bundled TURN relay are provided by tauri-app. On the plain web none of that
// exists, so we render a "open in the desktop app" landing page instead of the
// call UI.
//
// The globals tauri-app injects have now changed TWICE under us, and each time
// the app silently fell through to the landing page inside the desktop:
//
//   Tauri v1 (tauri-app 1.8)  →  window.__TAURI_INVOKE__ / __TAURI_IPC__
//   Tauri v2 (tauri-app 2.x)  →  window.isTauri + window.__TAURI_INTERNALS__
//
// `window.__TAURI__` only exists in `withGlobalTauri: true` builds, and every
// tauri-app window that hosts an external app sets it to FALSE — so it must
// never be the only thing we look for.
//
// `window.isTauri === true` is the officially supported marker: Tauri v2 defines
// it in an unconditional main-frame init script (see tauri's
// manager/webview.rs), for LOCAL and REMOTE URLs alike, before any page script
// runs. It is checked first; the rest are kept so a downgraded or differently
// configured shell still resolves to `true`.

declare global {
  interface Window {
    isTauri?: unknown;
    __TAURI_INTERNALS__?: unknown;
    __TAURI_IPC__?: unknown;
    __TAURI__?: unknown;
    __TAURI_INVOKE__?: (cmd: string, args?: unknown) => Promise<unknown>;
  }
}

/** The subset of `window` that desktop detection reads. */
export type TauriGlobals = Pick<
  Window,
  "isTauri" | "__TAURI_INTERNALS__" | "__TAURI_IPC__" | "__TAURI__" | "__TAURI_INVOKE__"
>;

/**
 * Whether `win` is a Tauri webview. Pure so the shape of every shell we have to
 * support is pinned by tests instead of discovered in production.
 */
export function detectTauri(win: TauriGlobals): boolean {
  return (
    win.isTauri === true || // Tauri v2 — unconditional, remote URLs included
    "__TAURI_INTERNALS__" in win || // Tauri v2 IPC bridge
    typeof win.__TAURI_INVOKE__ === "function" || // Tauri v1 (tauri-app 1.8)
    "__TAURI_IPC__" in win || // Tauri v1 native IPC bridge
    "__TAURI__" in win // withGlobalTauri builds only
  );
}

export const IS_TAURI = detectTauri(window);

// ── Dev-only browser harness ──────────────────────────────────────────────────
//
// Mero Meet is desktop-only in production, but a real video call needs TWO
// context members, which a single desktop instance can't provide on one laptop.
// For solo testing we run two local nodes and point two browser profiles at
// them — see scripts/dev-node*.sh + DEV-TESTING.md. The desktop normally hands
// the node + auth + room in via the URL hash; the harness builds the exact same
// hash by hand, so when one is present we let the full app run in a plain
// browser. Gated on import.meta.env.DEV so it can NEVER be true in a prod build.

/** Whether `hash` (with or without a leading `#`) carries a dev browser session. */
export function hasDevSessionHash(hash: string): boolean {
  try {
    const p = new URLSearchParams(hash.replace(/^#/, ""));
    return Boolean((p.get("node_url") ?? p.get("nodeUrl")) && p.get("access_token"));
  } catch {
    return false;
  }
}

function hasDevSession(): boolean {
  if (!import.meta.env.DEV) return false;
  return hasDevSessionHash(window.location.hash);
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
 * Used by the optional native-WebRTC bridge (ICE/TURN servers) and the
 * window-close flow. Tries the Tauri v2 bridge FIRST: `__TAURI_INVOKE__` is the
 * v1 global, which the current desktop no longer injects — keying off it alone
 * made every invoke resolve to `null`, silently dropping the desktop's TURN
 * relay instead of using it.
 *
 * When no command surface is present — a shell that predates the command, or a
 * unit test — this resolves to `null` so callers fall back gracefully.
 */
export async function invokeTauri<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  const invoke = resolveInvoke();
  if (!invoke) return null;
  try {
    return (await invoke(cmd, args ?? {})) as T;
  } catch {
    return null;
  }
}

type InvokeFn = (cmd: string, args?: unknown) => Promise<unknown>;

function resolveInvoke(): InvokeFn | null {
  // Tauri v2: window.__TAURI_INTERNALS__.invoke — always injected, even for
  // remote (https-hosted) app pages.
  const internals = window.__TAURI_INTERNALS__ as { invoke?: InvokeFn } | undefined;
  if (internals && typeof internals.invoke === "function") {
    return internals.invoke.bind(internals);
  }
  // Tauri v2 with withGlobalTauri: window.__TAURI__.core.invoke
  const globalApi = window.__TAURI__ as { core?: { invoke?: InvokeFn } } | undefined;
  if (globalApi?.core && typeof globalApi.core.invoke === "function") {
    return globalApi.core.invoke.bind(globalApi.core);
  }
  // Tauri v1
  if (typeof window.__TAURI_INVOKE__ === "function") {
    return window.__TAURI_INVOKE__;
  }
  return null;
}

/** Ask tauri-app to close this window (used by the "leave" / error flows). */
export async function closeWindow(): Promise<void> {
  await invokeTauri("close_current_window");
}
