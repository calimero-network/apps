import type { KeyValueStorage } from "@calimero-apps/connect";

/**
 * Log out: forget which voting group this browser had open for the account,
 * then end the session (the client signs out and the stored session is
 * dropped). With no session the app renders its front door (sign in), so
 * there is nowhere else to go.
 *
 * The group goes first because the next person to sign in on this browser may
 * not be a member of it. Two things deliberately stay:
 *
 *  * the light/dark choice: it belongs to the browser, not the account;
 *  * a trustee's transport key (utils/trusteeKeys.ts): it is the only copy of
 *    a secret a poll's count may still need, and dropping it on a log out
 *    would silently cost that poll a trustee.
 */
export async function signOut(
  end: () => Promise<void>,
  selection: string | null,
  storage: KeyValueStorage = localStorage,
): Promise<void> {
  if (selection) {
    try {
      storage.removeItem(selection);
    } catch {
      /* nothing stored */
    }
  }
  await end();
}
