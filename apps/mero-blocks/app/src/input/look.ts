// Look/aim input rules, kept pure so they can be unit-tested without a canvas.
//
// Three things conspire to make a MacBook a bad time in a browser voxel game,
// and each has its own helper here:
//
//  1. Pointer lock is not available everywhere. The Calimero desktop opens apps
//     in a Tauri (wry) WKWebView, and wry 0.55's `WKUIDelegate` implements only
//     `requestMediaCapturePermissionForOrigin` — there is no pointer-lock
//     delegate at all, so WebKit never grants the lock (wry 0.56.0 was the
//     release that added `PointerLock` to its permission handling). Without the
//     lock, `movementX` under a lock gate never arrives and the camera is dead.
//     → `pointerLockAvailable` decides up front whether to even try.
//  2. Trackpads have no mouse buttons to hold, and drag-to-look means holding a
//     click while dragging. → `ARROW_TURN` gives a hands-on-keyboard look that
//     needs no pointer at all.
//
// The third trackpad problem — a two-finger scroll spinning the hotbar — lives
// in ./wheel.ts, which merraria shares.

/** Radians per second an arrow key turns the camera (before sensitivity). */
export const ARROW_TURN = 2.2;

/**
 * The Tauri v2 marker. `window.__TAURI_INVOKE__`/`__TAURI_IPC__` are v1 and are
 * gone; `window.__TAURI__` needs `withGlobalTauri`, which the app windows set to
 * false. `window.isTauri` is set by an unconditional main-frame init script
 * before any page script runs, so it is the one reliable signal — including on
 * remote https:// pages, which is how the desktop loads us.
 */
export function isTauriRuntime(w: Window = window): boolean {
  const g = w as unknown as {
    isTauri?: unknown;
    __TAURI_INTERNALS__?: { invoke?: unknown };
    __TAURI_INVOKE__?: unknown;
  };
  if (g.isTauri === true) return true;
  if (typeof g.__TAURI_INTERNALS__?.invoke === "function") return true;
  return typeof g.__TAURI_INVOKE__ === "function"; // v1, kept as a trailing fallback
}

/**
 * Whether to attempt pointer lock at all. False in the desktop shell (see the
 * wry note above) — asking there costs a wasted click and a grace-window wait
 * before the fallback arms, which reads as "the game ignores my trackpad".
 * The runtime still watches for a lock that does show up and retires the
 * fallback if one ever does, so a fixed/upgraded webview needs no change here.
 */
export function pointerLockAvailable(w: Window = window): boolean {
  const el = (w as unknown as { Element?: { prototype?: { requestPointerLock?: unknown } } })
    .Element?.prototype;
  if (typeof el?.requestPointerLock !== "function") return false;
  return !isTauriRuntime(w);
}

/** Yaw/pitch delta (radians) from the arrow keys held this frame. */
export function arrowLook(
  keys: ReadonlySet<string>,
  dtMs: number,
  sensitivity: number,
): { dYaw: number; dPitch: number } {
  const step = (ARROW_TURN * sensitivity * Math.min(100, dtMs)) / 1000;
  const x = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
  const y = (keys.has("ArrowDown") ? 1 : 0) - (keys.has("ArrowUp") ? 1 : 0);
  return { dYaw: -x * step, dPitch: -y * step };
}
