// ── Tauri desktop detection ───────────────────────────────────────────────────
//
// Mero Meet is desktop-only. The Calimero node, auth/SSO, and (optionally) a
// bundled TURN relay are provided by tauri-app. On the plain web none of that
// exists, so we render a "open in the desktop app" landing page instead of the
// call UI. We detect the Tauri runtime the same way MeroDesign / MeroPixart do.

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI_INVOKE__?: (cmd: string, args?: unknown) => Promise<unknown>;
  }
}

export const IS_TAURI = "__TAURI_INTERNALS__" in window;

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
