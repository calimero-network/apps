import { log } from "./logger";

/**
 * Auto-request OS notification permission once per install.
 *
 * `useAppNotifications.notify` constructs `new Notification(...)` for banners,
 * but nothing ever asked for permission — so on a fresh install permission
 * stays "default", the constructor throws, and the `catch {}` there swallows
 * it. Native banners simply never appeared.
 *
 * Asked at most once (tracked in localStorage). Browsers show the prompt only
 * once per origin anyway, and re-asking every load is both useless and
 * user-hostile. A user who declines can still enable it via browser UI.
 */

const ASKED_KEY = "curb-notification-permission-asked";

function alreadyAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    // Storage blocked (private mode / embedded webview): treat as not asked.
    // Worst case the browser ignores a duplicate request.
    return false;
  }
}

function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    /* best-effort */
  }
}

/**
 * Request notification permission if it has never been requested.
 *
 * Resolves to the resulting permission, or `null` when there is nothing to do
 * (no Notification API, already decided, or already asked once).
 *
 * Call from a user gesture where possible — Safari requires one, and Chrome
 * penalises permission prompts that appear without interaction.
 */
export async function ensureNotificationPermission(): Promise<
  NotificationPermission | null
> {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return null;
  }

  // Already decided — "granted" needs nothing, "denied" cannot be re-prompted
  // from script (the user must change it in browser settings).
  if (Notification.permission !== "default") return null;

  if (alreadyAsked()) return null;

  // The desktop shell polyfills window.Notification for NSUserNotification and
  // may not implement requestPermission.
  if (typeof Notification.requestPermission !== "function") return null;

  markAsked();
  try {
    const result = await Notification.requestPermission();
    log.info("Notifications", `Permission request resolved: ${result}`);
    return result;
  } catch (error) {
    log.warn("Notifications", "Permission request failed", error);
    return null;
  }
}
