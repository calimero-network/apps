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
    getItem: (key) => items.get(key) ?? (key.startsWith("calimero-session:") && lent ? JSON.stringify(lent) : null),
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => {
      items.delete(key);
      if (key.startsWith("calimero-session:")) lent = null;
    },
  };
}

/** The extension's session, lent for creating a workspace it asked for; kept in memory only. */
let lent: { accountId: string; sessionToken: string; refreshToken: string; expiresAt: number } | null = null;

const LEND_KEY = "sylence:native-lend";

/**
 * Asks the extension for its session (`#native-sign-in&…&intent=create&lend=1`):
 * the person is signed in there already, so the page creates the workspace
 * with that session instead of asking them to sign in again. The extension
 * answers only its own page and this window's one-time state
 * (`externally_connectable`, background: lending). Nothing kept: the session
 * goes back to the extension, refreshed or not, when the window closes.
 */
export async function borrowExtensionSession(
  state: string,
  send: ((id: string, m: unknown) => Promise<unknown>) | null = extensionSend(),
): Promise<boolean> {
  if (!send) return false;
  try {
    const answer = (await Promise.race([
      send(EXTENSION_ID, { type: "lendSession", state }),
      new Promise((r) => setTimeout(() => r(null), 3_000)),
    ])) as { ok?: boolean; session?: typeof lent } | null;
    if (!answer?.ok || !answer.session?.sessionToken) return false;
    lent = answer.session;
    return true;
  } catch {
    return false;
  }
}

function extensionSend(): ((id: string, m: unknown) => Promise<unknown>) | null {
  const rt = (globalThis as { chrome?: { runtime?: { sendMessage?: (id: string, m: unknown, cb: (r: unknown) => void) => void } } }).chrome?.runtime;
  if (!rt?.sendMessage) return null;
  return (id, m) => new Promise((resolve) => rt.sendMessage!(id, m, (r) => resolve(r ?? null)));
}

/** Whether this window may borrow the extension's session (`&lend=1`), and its state. */
export function lendRequest(storage: Pick<Storage, "getItem"> = sessionStorage): string | null {
  try {
    return storage.getItem(LEND_KEY);
  } catch {
    return null;
  }
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
  const state = params.get("state");
  if (intent === "create" && params.get("lend") === "1" && state) storage.setItem(LEND_KEY, state);
  else storage.removeItem(LEND_KEY);
  if (intent === "create" || intent === "signup") storage.setItem(INTENT_KEY, intent);
  else storage.removeItem(INTENT_KEY);
  // The workspace the person named in the extension, created here without a form.
  const name = intent === "create" ? (params.get("name") ?? "").trim().slice(0, 80) : "";
  if (name) storage.setItem(NEW_WORKSPACE_KEY, JSON.stringify({ name, self: (params.get("self") ?? "").trim().slice(0, 48) }));
  else storage.removeItem(NEW_WORKSPACE_KEY);
  // A new account the person filled in in the extension: the page creates it without a form.
  if (intent === "signup" && params.has("name")) {
    storage.setItem(
      NEW_ACCOUNT_KEY,
      JSON.stringify({
        name: (params.get("name") ?? "").trim().slice(0, 48),
        label: (params.get("label") ?? "").trim().slice(0, 32),
        ws: (params.get("ws") ?? "").trim().slice(0, 80),
      }),
    );
  } else storage.removeItem(NEW_ACCOUNT_KEY);
}

const NEW_ACCOUNT_KEY = "sylence:native-new-account";

/** The account the extension asked for (`&intent=signup&name=…&label=…&ws=…`): your name, the passkey's label, a first workspace. */
export function newAccountRequest(storage: Pick<Storage, "getItem"> = sessionStorage): { name: string; label: string; ws: string } | null {
  try {
    const raw = storage.getItem(NEW_ACCOUNT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { name?: unknown; label?: unknown; ws?: unknown };
    const s = (x: unknown) => (typeof x === "string" ? x : "");
    return { name: s(v.name), label: s(v.label), ws: s(v.ws) };
  } catch {
    return null;
  }
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
