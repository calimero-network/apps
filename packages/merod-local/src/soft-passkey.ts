/**
 * A software passkey (ES256) that answers WebAuthn registration and assertion
 * ceremonies as a platform authenticator would, attestation format `none`.
 * For development clusters and tests only: the deployer account `dev:local`
 * signs up with, and the accounts the e2e scenarios run as.
 *
 * Adapted from mero-js's `tests/cloud-v2/soft-passkey.ts` (MIT), without
 * parameter properties so Node runs this file with its type stripping.
 */

import { b64url, type AssertionJSON, type PasskeyProvider, type RegistrationJSON } from "@calimero-network/mero-js";

const enc = new TextEncoder();

function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 256) return [(major << 5) | 24, n];
  if (n < 65536) return [(major << 5) | 25, n >> 8, n & 0xff];
  return [(major << 5) | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

type Cbor = number | string | Uint8Array | Array<[Cbor, Cbor]>;

function cbor(v: Cbor): number[] {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") {
    const b = enc.encode(v);
    return [...head(3, b.length), ...b];
  }
  if (v instanceof Uint8Array) return [...head(2, v.length), ...v];
  return [...head(5, v.length), ...v.flatMap(([k, x]) => [...cbor(k), ...cbor(x)])];
}

/** IEEE P1363 (r || s) to ASN.1 DER, which WebAuthn ES256 signatures use. */
function toDer(sig: Uint8Array): Uint8Array {
  const int = (x: Uint8Array): number[] => {
    let i = 0;
    while (i < x.length - 1 && x[i] === 0) i++;
    const t = [...x.slice(i)];
    if ((t[0] ?? 0) & 0x80) t.unshift(0);
    return [0x02, t.length, ...t];
  };
  const body = [...int(sig.slice(0, 32)), ...int(sig.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

function fromB64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded + "===".slice((padded.length + 3) % 4)), (c) => c.charCodeAt(0));
}

/**
 * A passkey as Chrome DevTools' `WebAuthn.addCredential` takes it (standard
 * base64): a browser's virtual authenticator holding it signs in as the same
 * account, from any origin with the same relying party.
 */
export interface BrowserCredential {
  credentialId: string;
  isResidentCredential: true;
  rpId: string;
  privateKey: string;
  userHandle: string;
  signCount: number;
}

function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export class SoftPasskey implements PasskeyProvider {
  private keys: CryptoKeyPair | undefined;
  private userHandle: Uint8Array | undefined;
  private readonly credentialId = crypto.getRandomValues(new Uint8Array(16));
  private counter = 0;
  private readonly rpId: string;
  private readonly origin: string;

  /** `rpId` and `origin` must be what the node trusts: one of `merod local --origins`. */
  constructor(rpId: string, origin: string) {
    this.rpId = rpId;
    this.origin = origin;
  }

  get id(): string {
    return b64url(this.credentialId);
  }

  private async authData(flags: number, attested?: Uint8Array): Promise<Uint8Array> {
    const out = [...(await sha256(enc.encode(this.rpId))), flags, ...[24, 16, 8, 0].map((s) => (this.counter >>> s) & 0xff)];
    return new Uint8Array(attested ? [...out, ...attested] : out);
  }

  private clientData(type: string, challenge: Uint8Array): Uint8Array {
    return enc.encode(JSON.stringify({ type, challenge: b64url(challenge), origin: this.origin, crossOrigin: false }));
  }

  async create(options: Record<string, unknown>): Promise<RegistrationJSON> {
    // Extractable for {@link toBrowser}; this passkey is for development and tests only.
    this.keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const user = (options as { user?: { id?: unknown } }).user?.id;
    this.userHandle = typeof user === "string" ? fromB64url(user) : undefined;
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", this.keys.publicKey));
    const cose = new Uint8Array(cbor([[1, 2], [3, -7], [-1, 1], [-2, raw.slice(1, 33)], [-3, raw.slice(33, 65)]]));
    const attested = new Uint8Array([...new Uint8Array(16), 0, this.credentialId.length, ...this.credentialId, ...cose]);
    const authData = await this.authData(0x01 | 0x04 | 0x40, attested);
    const att = new Uint8Array(cbor([["fmt", "none"], ["attStmt", []], ["authData", authData]]));
    const challenge = fromB64url((options as { challenge: string }).challenge);
    return { attestationObject: b64url(att), clientDataJson: b64url(this.clientData("webauthn.create", challenge)) };
  }

  async get(challenge: Uint8Array): Promise<AssertionJSON> {
    if (!this.keys) throw new Error("this passkey has not been registered yet");
    this.counter += 1;
    const clientData = this.clientData("webauthn.get", challenge);
    const authData = await this.authData(0x01 | 0x04);
    const message = new Uint8Array([...authData, ...(await sha256(clientData))]);
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys.privateKey, message));
    return {
      credentialId: this.id,
      authenticatorData: b64url(authData),
      clientDataJson: b64url(clientData),
      signature: b64url(toDer(sig)),
    };
  }

  /**
   * This passkey for a browser's virtual authenticator (`WebAuthn.addCredential`),
   * at its current signature counter: an e2e signs someone up here, does what
   * the browser cannot (install a package), then hands the browser the same
   * passkey. Use one or the other from then on, or the counters disagree.
   */
  async toBrowser(): Promise<BrowserCredential> {
    if (!this.keys || !this.userHandle) throw new Error("this passkey has not been registered yet");
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", this.keys.privateKey));
    return {
      credentialId: toB64(this.credentialId),
      isResidentCredential: true,
      rpId: this.rpId,
      privateKey: toB64(pkcs8),
      userHandle: toB64(this.userHandle),
      signCount: this.counter,
    };
  }
}
