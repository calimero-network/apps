/**
 * What this page may not do itself, handed to Calimero Desktop.
 *
 * Hyperfeed signs in with an app's grant set, which on purpose carries neither
 * `application:install` nor `context:delete`: the node answers both with a bare
 * 403. The desktop holds the node's own session, so it does them instead, once
 * you agree in its window. The hand-off is the desktop's app link,
 * `calimero://<package>/<action>?<params>`, with two actions it carries out
 * itself rather than opening an app: `install` and `delete-context`.
 */

/** What a call settles as when the desktop has it now. */
export const HANDED_OFF = "desktop" as const;
export type HandedOff = typeof HANDED_OFF;

/** Shown while the desktop waits for you. */
export const DESKTOP_NOTE = "Confirm in Calimero Desktop to finish.";

/**
 * The node refused this session the call: a 403 that is not a revoked login
 * (that one is "sign in again", which the desktop cannot do for you).
 */
export function refusedByNode(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { status?: unknown; name?: unknown };
  return err.status === 403 && err.name !== "AuthRevokedError";
}

interface TauriInternals {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Ask the desktop to carry out `action` for `pkg`. Inside a desktop window the
 * link is sent as the `app-deep-link` event the desktop listens for; anywhere
 * else it is opened as a `calimero://` link, which the OS hands to the desktop.
 */
export async function handToDesktop(pkg: string, action: string, params = ""): Promise<void> {
  const tauri = (window as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (tauri && typeof tauri.invoke === "function") {
    await tauri.invoke("plugin:event|emit", { event: "app-deep-link", payload: { slug: pkg, action, params } });
    return;
  }
  window.location.href = `calimero://${pkg}/${action}${params ? `?${params}` : ""}`;
}

/** How often, and for how long, a page looks for what the desktop did. */
export const HANDOFF_POLL_MS = 3000;
export const HANDOFF_WAIT_MS = 120_000;
