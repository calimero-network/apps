// ── Developer mode ────────────────────────────────────────────────────────────
//
// WebRTC is invisible plumbing for normal users — nothing about peers, signaling
// or ICE is ever shown in the UI. Developer mode is the *only* place any of it
// surfaces: a diagnostics overlay with the signaling log + per-peer connection
// stats. It's OFF by default in the packaged desktop app and only turns on when:
//   - explicitly toggled (Ctrl/Cmd+Shift+D in a call → persisted in localStorage), or
//   - running against the Vite dev server (import.meta.env.DEV).

const KEY = "mm-dev";

export function isDevMode(): boolean {
  try {
    if (localStorage.getItem(KEY) === "1") return true;
    if (localStorage.getItem(KEY) === "0") return false;
  } catch {
    /* localStorage unavailable */
  }
  return Boolean(import.meta.env.DEV);
}

export function setDevMode(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
