import type { KeyValueStorage } from "@calimero-apps/connect";

/**
 * The Sylence browser extension signs in through this page, as the iOS apps
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
 * extension's manifest (`apps/mero-sylence/extension`).
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


const INTENT_KEY = "sylence:native-intent";

/**
 * The extension's reason for this sign-in, from `#native-sign-in&…&intent=create`:
 * `create` shows the new-workspace step even when the account has workspaces.
 * Read before `captureNativeSignIn` takes the fragment out of the address, and
 * kept for this tab so the passkey round trip does not lose it.
 */
export function captureSignInIntent(
  location: Pick<Location, "hash"> = window.location,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = sessionStorage,
): void {
  const parts = location.hash.replace(/^#/, "").split("&");
  if (parts[0] !== "native-sign-in") return;
  const params = new URLSearchParams(parts.slice(1).join("&"));
  const intent = params.get("intent");
  if (intent === "create" || intent === "signup") storage.setItem(INTENT_KEY, intent);
  else storage.removeItem(INTENT_KEY);
  // The workspace the person named in the extension, created here without a form.
  const name = intent === "create" ? (params.get("name") ?? "").trim().slice(0, 80) : "";
  if (name) storage.setItem(NEW_WORKSPACE_KEY, JSON.stringify({ name, self: (params.get("self") ?? "").trim().slice(0, 48) }));
  else storage.removeItem(NEW_WORKSPACE_KEY);
}

const NEW_WORKSPACE_KEY = "sylence:native-new-workspace";

/** The workspace the extension asked for by name (`&intent=create&name=…&self=…`), if any. */
export function newWorkspaceRequest(storage: Pick<Storage, "getItem"> = sessionStorage): { name: string; self: string } | null {
  try {
    const raw = storage.getItem(NEW_WORKSPACE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { name?: unknown; self?: unknown };
    return typeof v.name === "string" && v.name ? { name: v.name, self: typeof v.self === "string" ? v.self : "" } : null;
  } catch {
    return null;
  }
}

export function signInIntent(storage: Pick<Storage, "getItem"> = sessionStorage): "create" | "signup" | null {
  try {
    const v = storage.getItem(INTENT_KEY);
    return v === "create" || v === "signup" ? v : null;
  } catch {
    return null;
  }
}
