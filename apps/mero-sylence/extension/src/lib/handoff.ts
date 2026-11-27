/**
 * Signing the extension in through Sylence' served page.
 *
 * A Cloud node trusts passkey ceremonies only on the frontend it serves from
 * the app's bundle, so the extension never asks for a passkey itself. It does
 * what the iOS and Android apps do (packages/passkey/src/native.ts, the Swift
 * SDK's `ServedPageHandoff`): it opens
 * `{origin}/{version}/#native-sign-in&state=…&key=…` in a sign-in window
 * (`authWindow.ts`), the person signs in on the page, and
 * the page sends the session back to the extension's callback sealed to a key
 * made for this one sign-in:
 *
 * - ECDH P-256 between the page's fresh key (`epk`, 65 bytes) and ours;
 * - HKDF-SHA256 over the shared secret, empty salt, info `calimero.native-sign-in.v1`;
 * - AES-256-GCM, 12-byte iv, additional data = the UTF-8 `state`;
 * - box = base64url(epk ‖ iv ‖ ciphertext), returned as `callback#state=…&box=…`.
 */
import { b64url, fromB64url } from "./b64url";

export const SIGN_IN_INFO = "calimero.native-sign-in.v1";
export const SIGN_IN_FRAGMENT = "native-sign-in";

/** What the page seals: packages/passkey `NativeSession`. */
export interface HandoffSession {
  v: 1;
  accountId: string;
  sessionToken: string;
  expiresAt: number;
  refreshToken: string;
  nodeUrl: string;
  nodes: string[];
}

/** One sign-in's key and state. The private key never leaves this object. */
export interface HandoffRequest {
  state: string;
  /** base64url of the uncompressed public key (65 bytes). */
  key: string;
  privateKey: CryptoKey;
}

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

export async function newHandoff(crypto: Crypto = globalThis.crypto): Promise<HandoffRequest> {
  const pair = (await crypto.subtle.generateKey(ECDH, false, ["deriveBits"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
  return { state, key: b64url(raw), privateKey: pair.privateKey };
}

/** Letters, digits and `-._~,` as they are; the rest percent-encoded (as the Swift SDK). */
function escape(value: string): string {
  return value.replace(/[^A-Za-z0-9\-._~,]/g, (c) =>
    Array.from(new TextEncoder().encode(c), (b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join(""),
  );
}

/**
 * The page to open. `version` is the release the origin serves (its
 * `/.well-known/calimero.json`); `null` for a page served at the root, as
 * `vite` serves it in development.
 */
export function signInUrl(
  origin: string,
  version: string | null,
  request: Pick<HandoffRequest, "state" | "key">,
  intent?: SignInIntent,
  workspace?: NewWorkspace,
  account?: NewAccount,
): string {
  const base = origin.replace(/\/+$/, "");
  const path = version ? `/${escape(version)}/` : "/";
  let extra = intent ? `&intent=${intent}` : "";
  // A workspace named in the extension: the page creates it without a form of its own.
  if (intent === "create" && workspace?.name.trim()) {
    extra += `&name=${encodeURIComponent(workspace.name.trim().slice(0, 80))}`;
    if (workspace.self.trim()) extra += `&self=${encodeURIComponent(workspace.self.trim().slice(0, 48))}`;
  }
  // A new account filled in in the extension: the page asks only for the passkey.
  if (intent === "signup" && account) {
    extra += `&name=${encodeURIComponent(account.name.trim().slice(0, 48))}`;
    if (account.label.trim()) extra += `&label=${encodeURIComponent(account.label.trim().slice(0, 32))}`;
    if (account.ws.trim()) extra += `&ws=${encodeURIComponent(account.ws.trim().slice(0, 80))}`;
  }
  return `${base}${path}#${SIGN_IN_FRAGMENT}&state=${request.state}&key=${request.key}${extra}`;
}

/** `create`: the page offers a new workspace before it hands the session over. */
/** `create`: a new workspace; `signup`: a new account (the page leads with creating one). */
export type SignInIntent = "create" | "signup";

/** A new account, as the person filled it in in the extension: their name, the passkey's label, a first workspace. */
export interface NewAccount {
  name: string;
  label: string;
  ws: string;
}

/** A workspace to start, as the person named it in the extension: its name, and theirs in it. */
export interface NewWorkspace {
  name: string;
  self: string;
}

export class HandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffError";
  }
}

/** The session in the page's answer. Throws on another state, a box we can't open, or a malformed answer. */
export async function openHandoff(
  request: HandoffRequest,
  callbackUrl: string,
  crypto: Crypto = globalThis.crypto,
): Promise<HandoffSession> {
  const hash = new URL(callbackUrl).hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  if (params.get("cancelled") === "1") throw new HandoffError("Sign-in was cancelled.");
  const state = params.get("state");
  const box = params.get("box");
  if (!state || !box) throw new HandoffError("The sign-in page sent no answer.");
  if (state !== request.state) throw new HandoffError("The sign-in answer is for another request.");
  let bytes: Uint8Array;
  try {
    bytes = fromB64url(box);
  } catch {
    throw new HandoffError("The sign-in answer is malformed.");
  }
  if (bytes.length < 65 + 12 + 16) throw new HandoffError("The sign-in answer is malformed.");
  const epk = bytes.slice(0, 65);
  const iv = bytes.slice(65, 77);
  const sealed = bytes.slice(77);
  let plain: ArrayBuffer;
  try {
    const theirs = await crypto.subtle.importKey("raw", epk, ECDH, false, []);
    const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, request.privateKey, 256);
    const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    const aes = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(SIGN_IN_INFO) },
      hkdf,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(request.state) },
      aes,
      sealed,
    );
  } catch {
    throw new HandoffError("The sign-in answer could not be opened.");
  }
  let session: unknown;
  try {
    session = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new HandoffError("The sign-in answer is malformed.");
  }
  if (!isHandoffSession(session)) throw new HandoffError("The sign-in answer is malformed.");
  return session;
}

function isHandoffSession(v: unknown): v is HandoffSession {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    s.v === 1 &&
    typeof s.accountId === "string" &&
    typeof s.sessionToken === "string" &&
    typeof s.refreshToken === "string" &&
    typeof s.expiresAt === "number" &&
    typeof s.nodeUrl === "string" &&
    /^https?:\/\//.test(s.nodeUrl) &&
    Array.isArray(s.nodes) &&
    s.nodes.every((n) => typeof n === "string")
  );
}
