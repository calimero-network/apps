// ── Which screen does a boot land on? ─────────────────────────────────────────
//
// Mero Meet has three "not in the app yet" screens and they are NOT
// interchangeable:
//
//   web-landing     "Desktop app required — Get Calimero Desktop". Correct ONLY
//                   on the plain web, where there is no node and no SSO.
//   desktop-signin  We ARE in the desktop (or a dev browser session) but the
//                   node hasn't authenticated us. Offers retry / sign-in.
//   loading         The auth probe is still in flight.
//
// The bug this replaces: the auth guard rendered `web-landing` for ANY
// unauthenticated state. So inside the desktop app — where the whole reason we
// have SSO is that the desktop hands us a token — a single failed
// `HEAD /auth/validate` (node still starting up, expired token, node restarted)
// dead-ended the window on a page telling the user to go install the desktop
// app they had just opened it from. There was no retry and no way forward.

export type BootScreen = "loading" | "app" | "web-landing" | "desktop-signin";

export interface BootState {
  /** {@link import("./tauri").APP_ENABLED} — desktop shell or dev browser session. */
  appEnabled: boolean;
  /** MeroProvider's auth probe is still running. */
  isLoading: boolean;
  /** MeroProvider holds a token the node accepted. */
  isAuthenticated: boolean;
}

/**
 * Pick the screen for a boot state.
 *
 * `appEnabled` is decided first and independently of auth: on the plain web
 * there is nothing to authenticate against, so "download the desktop app" is
 * the whole answer. Inside the desktop the answer is never that page.
 */
export function resolveBootScreen({
  appEnabled,
  isLoading,
  isAuthenticated,
}: BootState): BootScreen {
  if (!appEnabled) return "web-landing";
  if (isLoading) return "loading";
  return isAuthenticated ? "app" : "desktop-signin";
}

/**
 * Re-run the whole boot (MeroProvider re-probes auth with the stored tokens).
 *
 * A named seam rather than an inline `window.location.reload()` so the retry
 * paths are assertable in tests — jsdom refuses to let `location.reload` be
 * replaced.
 */
export function reloadApp(): void {
  window.location.reload();
}
