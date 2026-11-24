/**
 * The hand-offs between this served page and the Mero Tag iOS app. The wire
 * format is the one the Swift SDK opens (`ServedPageHandoff`,
 * `ServedPagePasskey`, `servedConsentReturnTo`).
 *
 * A native app can't use a `calimero.network` passkey for a session bound to
 * Mero Tag's package: iOS reports the assertion from the apex origin, which
 * matches no package. So the app opens this page, served from the package's
 * own origin, in the system sign-in sheet:
 *
 * - `{version}/#native-sign-in&state=…&key=…`: the person signs in here, and
 *   the session goes back to `mero-tag://signed-in#state=…&box=…`.
 * - `{version}/#native-approve&state=…&key=…&challenge=…&rpId=…&allow=…`: the
 *   person approves a step-up here, and the assertion goes back to
 *   `mero-tag://approved#state=…&box=…` (or `…&cancelled=1`).
 * - `{version}/?native-consent=1&request_id=…&result=…`: the node's consent
 *   page sent the person back here; the page passes it on to
 *   `mero-tag://consent?request_id=…&result=…`.
 *
 * `key` is base64url of an uncompressed P-256 public key (65 bytes), made for
 * one hand-off; `state` is base64url random, which the app checks and accepts
 * once. Both ride in the fragment, so no server sees them. The callbacks are
 * fixed here, never read from the URL, so a link can't send a session
 * anywhere else.
 *
 * The box is `base64url(epk ‖ iv ‖ ciphertext)`: ECDH P-256 between a fresh
 * key (`epk`, 65 bytes) and `key`; HKDF-SHA256 over the shared secret, empty
 * salt, info `calimero.native-sign-in.v1` (an approval:
 * `calimero.native-approve.v1`), 32 bytes; AES-256-GCM, 12-byte `iv`,
 * additional data the UTF-8 `state`.
 */

/** Where the app receives its session. */
export const SIGN_IN_CALLBACK = "mero-tag://signed-in";
/** Where the app receives a passkey approval. */
export const APPROVE_CALLBACK = "mero-tag://approved";
/** Where the app receives the node's consent decision. */
export const CONSENT_CALLBACK = "mero-tag://consent";

const SIGN_IN_FRAGMENT = "native-sign-in";
const SIGN_IN_INFO = "calimero.native-sign-in.v1";
const APPROVE_FRAGMENT = "native-approve";
const APPROVE_INFO = "calimero.native-approve.v1";
const CONSENT_PARAM = "native-consent";

const B64URL = /^[A-Za-z0-9_-]+$/;
const RP_ID = /^[a-z0-9.-]{1,253}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** What the app asked for. */
export interface NativeRequest {
  state: string;
  key: string;
}

/** What the app asks to be approved. */
export interface ApprovalRequest extends NativeRequest {
  /** The node's challenge, base64url. */
  challenge: string;
  rpId: string;
  /** The account's passkeys (base64url credential ids); empty: any. */
  allow: string[];
}

/** What the app receives after sign-in, sealed. */
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

/** An assertion as the node takes it (mero-js `AssertionJSON`). */
export interface Assertion {
  credentialId: string;
  authenticatorData: string;
  clientDataJson: string;
  signature: string;
}

export type Opened =
  | { kind: "sign-in"; request: NativeRequest }
  | { kind: "approve"; request: ApprovalRequest }
  | { kind: "consent"; url: string }
  | { kind: "none" };

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

/** `state` and `key`, if well formed: a 65-byte uncompressed P-256 key and a state of 16 to 128 characters. */
function validRequest(state: string, key: string): NativeRequest | null {
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
 * What the app opened this page for, read off the address bar (and taken off
 * it, so a reload or a shared link doesn't carry the request).
 */
export function readOpened(location: Location = window.location, history: History = window.history): Opened {
  const query = new URLSearchParams(location.search);
  if (query.get(CONSENT_PARAM) === "1") {
    const id = query.get("request_id") ?? "";
    const result = query.get("result") ?? "";
    const pass = REQUEST_ID.test(id)
      ? `?request_id=${encodeURIComponent(id)}${result === "approved" || result === "declined" ? `&result=${result}` : ""}`
      : "";
    return { kind: "consent", url: CONSENT_CALLBACK + pass };
  }

  const parts = location.hash.replace(/^#/, "").split("&");
  if (parts[0] !== SIGN_IN_FRAGMENT && parts[0] !== APPROVE_FRAGMENT) return { kind: "none" };
  const params = new URLSearchParams(parts.slice(1).join("&"));
  history.replaceState(null, "", location.pathname + location.search);
  const base = validRequest(params.get("state") ?? "", params.get("key") ?? "");
  if (!base) return { kind: "none" };
  if (parts[0] === SIGN_IN_FRAGMENT) return { kind: "sign-in", request: base };

  const challenge = params.get("challenge") ?? "";
  const rpId = params.get("rpId") ?? "";
  const allow = (params.get("allow") ?? "").split(",").filter(Boolean);
  if (challenge.length < 16 || challenge.length > 512 || !B64URL.test(challenge)) return { kind: "none" };
  if (!RP_ID.test(rpId)) return { kind: "none" };
  if (allow.length > 64 || allow.some((id) => id.length > 1024 || !B64URL.test(id))) return { kind: "none" };
  return { kind: "approve", request: { ...base, challenge, rpId, allow } };
}

/** `plaintext` sealed to the app's key under HKDF info `info` (format above). */
async function seal(request: NativeRequest, plaintext: string, info: string): Promise<string> {
  const subtle = crypto.subtle;
  const ecdh = { name: "ECDH", namedCurve: "P-256" } as const;
  const appKey = await subtle.importKey("raw", fromB64url(request.key), ecdh, false, []);
  const mine = await subtle.generateKey(ecdh, true, ["deriveBits"]);
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

function answer(callback: string, state: string, box: string): string {
  return `${callback}#state=${encodeURIComponent(state)}&box=${encodeURIComponent(box)}`;
}

/** The URL that hands `session` to the app. */
export async function signedInUrl(request: NativeRequest, session: NativeSession): Promise<string> {
  return answer(SIGN_IN_CALLBACK, request.state, await seal(request, JSON.stringify(session), SIGN_IN_INFO));
}

/** The URL that hands the approval's `assertion` to the app. */
export async function approvedUrl(request: ApprovalRequest, assertion: Assertion): Promise<string> {
  return answer(APPROVE_CALLBACK, request.state, await seal(request, JSON.stringify({ v: 1, assertion }), APPROVE_INFO));
}

/** The URL that tells the app the person declined the approval. */
export function declinedUrl(request: ApprovalRequest): string {
  return `${APPROVE_CALLBACK}#state=${encodeURIComponent(request.state)}&cancelled=1`;
}
