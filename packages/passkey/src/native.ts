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
export function sealNativeSession(
  request: NativeRequest,
  session: NativeSession,
  crypto: Crypto = globalThis.crypto,
): Promise<string> {
  return sealToApp(request, JSON.stringify(session), NATIVE_INFO, crypto);
}

/** `plaintext` sealed to the app's key, under HKDF info `info` (format above). */
async function sealToApp(
  request: NativeRequest,
  plaintext: string,
  info: string,
  crypto: Crypto = globalThis.crypto,
): Promise<string> {
  const subtle = crypto.subtle;
  const ecdh = { name: "ECDH", namedCurve: "P-256" } as const;
  const appKey = await subtle.importKey("raw", fromB64url(request.key), ecdh, false, []);
  const mine = (await subtle.generateKey(ecdh, true, ["deriveBits"])) as CryptoKeyPair;
  const shared = await subtle.deriveBits({ name: "ECDH", public: appKey }, mine.privateKey, 256);
  const hkdf = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aes = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(request.state) },
    aes,
    new TextEncoder().encode(plaintext),
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

// ---------------------------------------------------------------- approvals

/*
 * A passkey approval for a native app (`412 CONFIRM_REQUIRED`: creating an
 * invite, removing a member, …). The app's session is bound to this package,
 * so the node accepts the approval only from this page's origin, and the app
 * can't make it with a `calimero.network` passkey itself. It opens
 * `{version}/#native-approve&state=…&key=…&challenge=…&rpId=…&allow=…`; the
 * person approves here with their passkey, and the assertion goes back to the
 * app's callback sealed as above, under HKDF info `calimero.native-approve.v1`.
 *
 * The assertion is worth something only to a holder of this account's session:
 * the node's challenge commits to the account, the method and its arguments.
 * The page still says it acts for the app, so a person who reached it from a
 * link can tell.
 */

/** The fragment that marks a native approval. */
export const NATIVE_APPROVE_FRAGMENT = "native-approve";
/** HKDF info of an approval's box. */
export const NATIVE_APPROVE_INFO = "calimero.native-approve.v1";

/** What the app asks to be approved. */
export interface NativeApprovalRequest extends NativeRequest {
  /** The node's challenge, base64url. */
  challenge: string;
  rpId: string;
  /** The account's passkeys (base64url credential ids); empty: any. */
  allow: string[];
}

/** The assertion, as the node takes it (mero-js `AssertionJSON`). */
export interface NativeAssertion {
  credentialId: string;
  authenticatorData: string;
  clientDataJson: string;
  signature: string;
}

/** What signs the challenge: mero-js `browserPasskey()` in a page. */
export interface NativeApprover {
  get(challenge: Uint8Array, rpId: string, allowCredentials?: string[]): Promise<NativeAssertion>;
}

let capturedApproval: NativeApprovalRequest | null = null;

const RP_ID = /^[a-z0-9.-]{1,253}$/;

/** `request`, if it is well formed (as {@link validRequest}, plus a challenge, an rp id and credential ids). */
export function validApprovalRequest(
  request: Partial<NativeApprovalRequest> | null | undefined,
): NativeApprovalRequest | null {
  const base = validRequest(request);
  if (!base) return null;
  const challenge = request?.challenge ?? "";
  const rpId = request?.rpId ?? "";
  const allow = request?.allow ?? [];
  if (challenge.length < 16 || challenge.length > 512 || !B64URL.test(challenge)) return null;
  if (!RP_ID.test(rpId)) return null;
  if (allow.length > 64 || allow.some((id) => !id || id.length > 1024 || !B64URL.test(id))) return null;
  return { ...base, challenge, rpId, allow };
}

/**
 * Takes `#native-approve&…` off the address bar. Run before the router
 * mounts. Returns the request, or `null` when the page wasn't opened for one.
 */
export function captureNativeApproval(
  location: Pick<Location, "hash" | "pathname" | "search"> = window.location,
  history: Pick<History, "replaceState"> = window.history,
): NativeApprovalRequest | null {
  const parts = location.hash.replace(/^#/, "").split("&");
  if (parts[0] !== NATIVE_APPROVE_FRAGMENT) return null;
  const params = new URLSearchParams(parts.slice(1).join("&"));
  const allow = (params.get("allow") ?? "").split(",").filter(Boolean);
  capturedApproval = validApprovalRequest({
    state: params.get("state") ?? "",
    key: params.get("key") ?? "",
    challenge: params.get("challenge") ?? "",
    rpId: params.get("rpId") ?? "",
    allow,
  });
  history.replaceState(null, "", location.pathname + location.search);
  return capturedApproval;
}

/** The approval this page was opened for, or `null`. */
export function pendingNativeApproval(): NativeApprovalRequest | null {
  return capturedApproval;
}

/**
 * Signs the app's challenge with the person's passkey and sends the sealed
 * assertion to the app's own `callback` (`callback#state=…&box=…`). Throws
 * when the passkey prompt fails; the page can offer it again.
 */
export async function approveNative(options: {
  approver: NativeApprover;
  /** The app's own callback, e.g. `mero-chat://approved`. */
  callback: string;
  request?: NativeApprovalRequest | null;
  go?: (url: string) => void;
  crypto?: Crypto;
}): Promise<boolean> {
  const request = options.request === undefined ? capturedApproval : options.request;
  if (!request) return false;
  const assertion = await options.approver.get(
    fromB64url(request.challenge),
    request.rpId,
    request.allow.length ? request.allow : undefined,
  );
  const box = await sealToApp(request, JSON.stringify({ v: 1, assertion }), NATIVE_APPROVE_INFO, options.crypto);
  if (options.request === undefined) capturedApproval = null;
  (options.go ?? ((url) => window.location.assign(url)))(nativeReturnUrl(options.callback, request.state, box));
  return true;
}

/** The person declined: tell the app (`callback#state=…&cancelled=1`) so it stops waiting. */
export function declineNative(options: {
  callback: string;
  request?: NativeApprovalRequest | null;
  go?: (url: string) => void;
}): void {
  const request = options.request === undefined ? capturedApproval : options.request;
  if (!request) return;
  if (options.request === undefined) capturedApproval = null;
  (options.go ?? ((url) => window.location.assign(url)))(
    `${options.callback}#state=${encodeURIComponent(request.state)}&cancelled=1`,
  );
}

// ---------------------------------------------------------------- consent returns

/*
 * The node's consent page (an app upgrade, a node release) sends the person
 * back only to the requesting app's own frontend origin, over https, so a
 * native app can't name its own scheme as `returnTo`. It names this page with
 * `?native-consent=1` instead, and the page passes the result on to the app:
 * `callback?request_id=…&result=…`. Both values are re-read from the node by
 * the app; nothing here is trusted.
 */

/** The query flag that marks a consent page's return for a native app. */
export const NATIVE_CONSENT_PARAM = "native-consent";

const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;
const RESULTS = new Set(["approved", "declined"]);

/**
 * When the consent page sent the person back here for a native app, send them
 * on to the app's `callback` and say so (the page then renders nothing).
 */
export function bounceNativeConsent(
  location: Pick<Location, "search"> = window.location,
  callback: string,
  go: (url: string) => void = (url) => window.location.replace(url),
): boolean {
  const params = new URLSearchParams(location.search);
  if (params.get(NATIVE_CONSENT_PARAM) !== "1") return false;
  const id = params.get("request_id") ?? "";
  const result = params.get("result") ?? "";
  const query = REQUEST_ID.test(id)
    ? `request_id=${encodeURIComponent(id)}${RESULTS.has(result) ? `&result=${result}` : ""}`
    : "";
  go(query ? `${callback}?${query}` : callback);
  return true;
}
