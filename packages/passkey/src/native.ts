/**
 * Signing a native app in through this served page.
 *
 * A native app can't use a `calimero.network` passkey safely itself: iOS
 * reports such an assertion from the apex origin, which matches no package,
 * and the node would open an unbound session. So the app opens this page in
 * the system sign-in sheet (`ASWebAuthenticationSession`, Custom Tabs). The
 * person signs in here as on the web, which binds the session to this
 * package. The page then seals the session to a key the app made for this one
 * sign-in and sends it back to the app's own callback.
 *
 * The app opens `https://{label}.apps.calimero.network/{version}/#native-sign-in&state=…&key=…`:
 * - `key`: base64url of an uncompressed P-256 public key (65 bytes), made for this sign-in only.
 * - `state`: base64url random, which the app checks and accepts once.
 *
 * The parameters ride in the fragment, so they never reach a server.
 * The callback is the app's own (`callback` below), never taken from the URL,
 * so a link can't send a session anywhere else.
 *
 * The sealed box, `base64url(epk ‖ iv ‖ ciphertext)`:
 * - ECDH P-256 between a fresh key (`epk`, 65 bytes uncompressed) and `key`;
 * - HKDF-SHA256 over the shared secret, empty salt, info `calimero.native-sign-in.v1`, 32 bytes;
 * - AES-256-GCM, 12-byte `iv`, additional data = the UTF-8 `state`.
 *
 * The plaintext is {@link NativeSession} as JSON. The Swift and Kotlin SDKs open it
 * (`ServedPageHandoff`).
 */

/** The fragment that marks a native sign-in. */
export const NATIVE_FRAGMENT = "native-sign-in";
/** Where a captured request waits through the ceremony (this tab only). */
export const NATIVE_STORAGE_KEY = "calimero:native-sign-in";
/** HKDF info, the box's version. */
export const NATIVE_INFO = "calimero.native-sign-in.v1";

/** What the app asked for. */
export interface NativeRequest {
  state: string;
  key: string;
}

/** What the app receives, sealed. */
export interface NativeSession {
  v: 1;
  accountId: string;
  sessionToken: string;
  expiresAt: number;
  refreshToken: string;
  /** The node the page signed in on, and the rest of its cluster. */
  nodeUrl: string;
  nodes: string[];
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * The request captured on this page load. Kept in memory too: an app's own
 * code may clear `sessionStorage` before its sign-in (mero-chat's
 * `clearStorageForConnect` does), and the request must survive that.
 */
let captured: NativeRequest | null = null;

const B64URL = /^[A-Za-z0-9_-]+$/;

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** `request`, if it is well formed: a 65-byte uncompressed P-256 key and a state of 16 to 128 characters. */
export function validRequest(request: Partial<NativeRequest> | null | undefined): NativeRequest | null {
  const state = request?.state ?? "";
  const key = request?.key ?? "";
  if (state.length < 16 || state.length > 128 || !B64URL.test(state)) return null;
  if (!B64URL.test(key)) return null;
  let raw: Uint8Array;
  try {
    raw = fromB64url(key);
  } catch {
    return null;
  }
  if (raw.length !== 65 || raw[0] !== 0x04) return null;
  return { state, key };
}

/**
 * Takes `#native-sign-in&state=…&key=…` off the address bar into this tab's
 * storage. Run before the router mounts. Returns the request, or `null` when
 * the page wasn't opened for one (or its parameters are malformed).
 */
export function captureNativeSignIn(
  location: Pick<Location, "hash" | "pathname" | "search"> = window.location,
  storage: Store = sessionStorage,
  history: Pick<History, "replaceState"> = window.history,
): NativeRequest | null {
  const hash = location.hash.replace(/^#/, "");
  const parts = hash.split("&");
  if (parts[0] !== NATIVE_FRAGMENT) return null;
  const params = new URLSearchParams(parts.slice(1).join("&"));
  const request = validRequest({ state: params.get("state") ?? "", key: params.get("key") ?? "" });
  history.replaceState(null, "", location.pathname + location.search);
  captured = request;
  if (!request) {
    storage.removeItem(NATIVE_STORAGE_KEY);
    return null;
  }
  storage.setItem(NATIVE_STORAGE_KEY, JSON.stringify(request));
  return request;
}

/** The captured request waiting for a session, or `null`. */
export function pendingNativeSignIn(storage: Store = sessionStorage): NativeRequest | null {
  if (captured) return captured;
  try {
    const raw = storage.getItem(NATIVE_STORAGE_KEY);
    return raw ? validRequest(JSON.parse(raw) as Partial<NativeRequest>) : null;
  } catch {
    return null;
  }
}

export function dropNativeSignIn(storage: Store = sessionStorage): void {
  captured = null;
  storage.removeItem(NATIVE_STORAGE_KEY);
}

/** Seals `session` to the app's key (format above). */
export async function sealNativeSession(
  request: NativeRequest,
  session: NativeSession,
  crypto: Crypto = globalThis.crypto,
): Promise<string> {
  const subtle = crypto.subtle;
  const ecdh = { name: "ECDH", namedCurve: "P-256" } as const;
  const appKey = await subtle.importKey("raw", fromB64url(request.key), ecdh, false, []);
  const mine = (await subtle.generateKey(ecdh, true, ["deriveBits"])) as CryptoKeyPair;
  const shared = await subtle.deriveBits({ name: "ECDH", public: appKey }, mine.privateKey, 256);
  const hkdf = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aes = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(NATIVE_INFO) },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(request.state) },
    aes,
    new TextEncoder().encode(JSON.stringify(session)),
  );
  const epk = new Uint8Array(await subtle.exportKey("raw", mine.publicKey));
  const box = new Uint8Array(epk.length + iv.length + sealed.byteLength);
  box.set(epk, 0);
  box.set(iv, epk.length);
  box.set(new Uint8Array(sealed), epk.length + iv.length);
  return b64url(box);
}

/** Where the app is sent back to: `callback#state=…&box=…`. */
export function nativeReturnUrl(callback: string, state: string, box: string): string {
  return `${callback}#state=${encodeURIComponent(state)}&box=${encodeURIComponent(box)}`;
}

/** What {@link finishNativeSignIn} needs of the signed-in client. */
export interface NativeClient {
  readonly session: { accountId: string; sessionToken: string; expiresAt: number; refreshToken: string } | undefined;
  readonly nodeUrl: string;
  readonly nodes: string[];
}

/**
 * Hands the signed-in session to the app that opened this page, then forgets
 * it here (`forgetHere`; never a sign-out, which would end the app's session too).
 * Returns whether there was a request to finish.
 */
export async function finishNativeSignIn(options: {
  client: NativeClient;
  /** The app's own callback, e.g. `mero-chat://signed-in`. */
  callback: string;
  forgetHere: () => void;
  go?: (url: string) => void;
  storage?: Store;
  crypto?: Crypto;
}): Promise<boolean> {
  const storage = options.storage ?? sessionStorage;
  const request = pendingNativeSignIn(storage);
  const session = options.client.session;
  if (!request || !session) return false;
  const box = await sealNativeSession(
    request,
    {
      v: 1,
      accountId: session.accountId,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      refreshToken: session.refreshToken,
      nodeUrl: options.client.nodeUrl,
      nodes: options.client.nodes.filter((n) => n !== options.client.nodeUrl),
    },
    options.crypto,
  );
  dropNativeSignIn(storage);
  options.forgetHere();
  (options.go ?? ((url) => window.location.assign(url)))(nativeReturnUrl(options.callback, request.state, box));
  return true;
}
