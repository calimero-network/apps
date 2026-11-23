import type { KeyValueStorage } from "@calimero-apps/connect";

/**
 * The Minutes browser extension signs in through this page, as the iOS apps
 * do through theirs: a Cloud node trusts a passkey ceremony only from the
 * frontend it serves from the bundle, which an extension's own origin is not.
 *
 * The extension opens `<served origin>/{version}/#native-sign-in&state=…&key=…`
 * with `chrome.identity.launchWebAuthFlow`. Once the person is signed in here,
 * `finishNativeSignIn` (`@calimero-apps/passkey/native`) seals the session to
 * the extension's key and navigates to the callback below; Chrome hands that
 * URL, fragment and all, back to the extension and closes the window.
 *
 * The callbacks are constants, never read from the URL, so a link cannot send
 * a session anywhere but this extension. The id is pinned by the `key` in the
 * extension's manifest (`apps/mero-minutes/extension`).
 */
export const EXTENSION_ID = "ljpjgindjakdpmbpjdcpadihhnaemocf";

/** Where the extension receives its sealed session. */
export const NATIVE_CALLBACK = `https://${EXTENSION_ID}.chromiumapp.org/signed-in`;

/** Where the extension receives a passkey approval (`#native-approve`). */
export const NATIVE_APPROVE_CALLBACK = `https://${EXTENSION_ID}.chromiumapp.org/approved`;

/**
 * A storage that forgets everything when the page goes: while the extension's
 * sign-in is pending, the page neither restores a session it kept before (the
 * extension gets one of its own) nor keeps the one it hands over.
 */
export function memoryStorage(): KeyValueStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

/** Where a person gets the extension. */
export const EXTENSION_URL = "https://github.com/calimero-network/apps/tree/main/apps/mero-minutes/extension#install";
