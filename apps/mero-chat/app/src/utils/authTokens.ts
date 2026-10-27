// The session check the route gate shares.
//
// v1 delivered node tokens in the URL hash (Tauri SSO and the node's web auth)
// and this module seeded them into mero-js's `mero-tokens` store before React
// mounted. On Calimero Cloud a person signs in with a passkey in the page: the
// session lives in memory, its refresh token in this tab's sessionStorage
// (`@calimero-apps/cloud`'s readSession), and there is no hash to seed.

import { readSession } from "@calimero-apps/cloud";

/**
 * True when this page holds a session — i.e. a real sign-in, even during the
 * brief window right after a fresh connect where the provider's reactive
 * `isAuthenticated` still lags `false`. The route gate ORs this in so a
 * client-side navigate into a workspace doesn't bounce back to the picker.
 * Entry still separately requires explicit namespace selection
 * (`isNamespaceReady`), so this does not widen the gate.
 *
 * A session restored from the tab's refresh token counts once refreshed: its
 * stub carries no session token yet.
 */
export function hasLiveSession(): boolean {
  const session = readSession();
  return !!session && session.sessionToken !== "" && session.expiresAt * 1000 > Date.now();
}
