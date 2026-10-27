import { clearContextId } from "@calimero-apps/cloud";

/**
 * Log out: forget which context this browser had open, then let mero-react
 * drop the session (its token store, the `mero:*` keys and any delegated
 * account), as Mero CRM and Mero Chat do. With no session the app renders its
 * front door ("Connect a node"), so there is nowhere else to go.
 *
 * The context goes first because the next person to sign in on this browser
 * may not be a member of it. Two things deliberately stay:
 *
 *  * the light/dark choice: it belongs to the browser, not the account;
 *  * a trustee's transport key (utils/trusteeKeys.ts): it is the only copy of
 *    a secret a poll's count may still need, and dropping it on a log out
 *    would silently cost that poll a trustee.
 */
export function signOut(logout: () => void): void {
  clearContextId();
  logout();
}
