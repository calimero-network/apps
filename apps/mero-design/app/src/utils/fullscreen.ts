import { isTauri } from "./saveFile";

/**
 * Full screen that also works in the desktop app.
 *
 * The browser path is the Fullscreen API. The desktop shell's WKWebView has it
 * switched off (wry only enables `fullScreenEnabled` under Tauri's
 * `macos-private-api` feature, which tauri-app does not build with), so there
 * `requestFullscreen` is missing or rejects and the button did nothing. Under
 * Tauri this falls back to making the app's own window full screen through the
 * window plugin. `is_fullscreen` is allowed to every window by `core:default`;
 * `set_fullscreen` needs `core:window:allow-set-fullscreen` on the `app-*`
 * windows — when the shell does not grant it the call rejects, and the caller
 * gets "unsupported" so it can tell the user about the system shortcut instead.
 */

interface TauriInternals {
  invoke: (cmd: string, args?: unknown) => Promise<unknown>;
  metadata?: { currentWindow?: { label?: string }; currentWebview?: { windowLabel?: string } };
}

function tauri(): TauriInternals | null {
  return isTauri() ? (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__ : null;
}

function windowLabel(t: TauriInternals): string | undefined {
  return t.metadata?.currentWindow?.label ?? t.metadata?.currentWebview?.windowLabel;
}

async function setWindowFullscreen(t: TauriInternals, value: boolean): Promise<void> {
  await t.invoke("plugin:window|set_fullscreen", { label: windowLabel(t), value });
}

async function windowIsFullscreen(t: TauriInternals): Promise<boolean> {
  return (await t.invoke("plugin:window|is_fullscreen", { label: windowLabel(t) }).catch(() => false)) === true;
}

/** Whether the page is full screen, by either mechanism. */
export async function isFullscreen(): Promise<boolean> {
  if (document.fullscreenElement) return true;
  const t = tauri();
  return t ? windowIsFullscreen(t) : false;
}

export type FullscreenResult = "on" | "off" | "unsupported";

/** Flips full screen. "unsupported" means neither mechanism was allowed. */
export async function toggleFullscreen(): Promise<FullscreenResult> {
  if (document.fullscreenElement) {
    await document.exitFullscreen?.().catch(() => {});
    return "off";
  }
  const t = tauri();
  if (t && (await windowIsFullscreen(t))) {
    await setWindowFullscreen(t, false).catch(() => {});
    return "off";
  }
  if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
    try {
      await document.documentElement.requestFullscreen();
      return "on";
    } catch {
      // Refused (no user gesture, or a webview that reports support it lacks):
      // try the window instead.
    }
  }
  if (t) {
    try {
      await setWindowFullscreen(t, true);
      return "on";
    } catch {
      return "unsupported";
    }
  }
  return "unsupported";
}

/** Leaves full screen, whichever mechanism entered it. */
export async function exitFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen?.().catch(() => {});
    return;
  }
  const t = tauri();
  if (t && (await windowIsFullscreen(t))) await setWindowFullscreen(t, false).catch(() => {});
}

/** What to press when the button cannot do it. */
export function fullscreenShortcut(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌃⌘F" : "F11";
}
