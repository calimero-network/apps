// ── End-to-end encryption for a vault ────────────────────────────────────────
//
// The node never holds a readable secret. Every name, field and tag list is
// sealed HERE, in the browser, before it is sent to the contract, and opened
// here after it comes back. What the node, its disk, its logs and its operator
// see is ciphertext.
//
//   device key    ECDH P-256, one per browser. The private half is generated
//                 NON-EXTRACTABLE and kept in IndexedDB (`deviceKey.ts`); it
//                 cannot be read out, even by this code.
//   vault key     32 random bytes, AES-256-GCM. Identified by `keyId =
//                 hex(SHA-256(key))`, so a recipient can check that the key it
//                 unwrapped is the key it was told about — a forged wrap from a
//                 hostile member is detected, not trusted.
//   key wrap      ECIES: an ephemeral P-256 key agrees with the recipient's
//                 device key, HKDF-SHA256 derives an AES-GCM key, and that seals
//                 the vault key. One wrap per (vault key, recipient device).
//   field seal    AES-256-GCM under the vault key, with the secret id and field
//                 name bound in as associated data: an envelope cut from one
//                 secret's `password` and pasted into another's fails to open.
//
// Rotation mints a new vault key and wraps it only to the devices still
// entitled to it. Old keys stay in each member's keyring so history written
// under them still opens; a removed member keeps what they already had (no
// scheme can retract bytes already decrypted), but nothing written after the
// rotation.
//
// Pure WebCrypto, no dependencies: the same code runs in the browser and under
// vitest (Node's `globalThis.crypto`).

const subtle = globalThis.crypto.subtle;

const WRAP_INFO = new TextEncoder().encode('mero-pass/key-wrap/v1');
const FIELD_PREFIX = 'mp1';

// ── Encoding helpers ─────────────────────────────────────────────────────────

export function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromB64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** WebCrypto wants an ArrayBuffer-backed view; a copy guarantees one. */
function buf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  out.set(bytes);
  return out;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest('SHA-256', buf(bytes)));
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

// ── Device keys ──────────────────────────────────────────────────────────────

export interface DeviceKeyPair {
  /** Non-extractable: usable for `deriveBits`, never readable. */
  privateKey: CryptoKey;
  /** Raw uncompressed point, 65 bytes. */
  publicRaw: Uint8Array;
}

export async function generateDeviceKey(): Promise<DeviceKeyPair> {
  const pair = (await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )) as CryptoKeyPair;
  const publicRaw = new Uint8Array(
    await subtle.exportKey('raw', pair.publicKey),
  );
  return { privateKey: pair.privateKey, publicRaw };
}

/** `hex(SHA-256(raw public key))` — the id a device is registered under. */
export async function fingerprintOf(publicRaw: Uint8Array): Promise<string> {
  return toHex(await sha256(publicRaw));
}

// ── Vault keys ───────────────────────────────────────────────────────────────

export interface VaultKey {
  keyId: string;
  /** Held in memory so this device can wrap the key to others. */
  raw: Uint8Array;
  aes: CryptoKey;
}

async function vaultKeyFrom(raw: Uint8Array): Promise<VaultKey> {
  const aes = await subtle.importKey('raw', buf(raw), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  return { keyId: toHex(await sha256(raw)), raw, aes };
}

export async function generateVaultKey(): Promise<VaultKey> {
  return vaultKeyFrom(randomBytes(32));
}

async function wrapKeyFor(
  ecdhPrivate: CryptoKey,
  peerPublicRaw: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const peer = await subtle.importKey(
    'raw',
    buf(peerPublicRaw),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = await subtle.deriveBits(
    { name: 'ECDH', public: peer },
    ecdhPrivate,
    256,
  );
  const hkdf = await subtle.importKey('raw', shared, 'HKDF', false, [
    'deriveKey',
  ]);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: WRAP_INFO },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

interface WrapEnvelope {
  v: 1;
  epk: string;
  iv: string;
  ct: string;
}

/**
 * Seal `key` to one device public key. The salt binds both public keys, and
 * the key id rides as associated data, so a wrap cannot be re-labelled as a
 * wrap of a different key.
 */
export async function wrapVaultKey(
  key: VaultKey,
  recipientPublicRaw: Uint8Array,
): Promise<string> {
  const eph = (await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )) as CryptoKeyPair;
  const epk = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const salt = new Uint8Array([...epk, ...recipientPublicRaw]);
  const kek = await wrapKeyFor(eph.privateKey, recipientPublicRaw, salt);
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: buf(iv),
        additionalData: new TextEncoder().encode(key.keyId),
      },
      kek,
      buf(key.raw),
    ),
  );
  const env: WrapEnvelope = {
    v: 1,
    epk: toB64(epk),
    iv: toB64(iv),
    ct: toB64(ct),
  };
  return JSON.stringify(env);
}

/**
 * Open a wrap addressed to this device. Returns null — never throws — for a
 * wrap that does not open or whose key does not hash to `keyId`: a member can
 * write garbage into their own wrap slot, and that must cost them nothing but
 * the slot.
 */
export async function unwrapVaultKey(
  envelope: string,
  keyId: string,
  device: DeviceKeyPair,
): Promise<VaultKey | null> {
  try {
    const env = JSON.parse(envelope) as WrapEnvelope;
    if (env.v !== 1) return null;
    const epk = fromB64(env.epk);
    const salt = new Uint8Array([...epk, ...device.publicRaw]);
    const kek = await wrapKeyFor(device.privateKey, epk, salt);
    const raw = new Uint8Array(
      await subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: buf(fromB64(env.iv)),
          additionalData: new TextEncoder().encode(keyId),
        },
        kek,
        buf(fromB64(env.ct)),
      ),
    );
    const key = await vaultKeyFrom(raw);
    return key.keyId === keyId ? key : null;
  } catch {
    return null;
  }
}

// ── Field sealing ────────────────────────────────────────────────────────────

/** Every key this device can open a vault's envelopes with. */
export class Keyring {
  private keys = new Map<string, VaultKey>();

  add(key: VaultKey): void {
    this.keys.set(key.keyId, key);
  }

  get(keyId: string): VaultKey | undefined {
    return this.keys.get(keyId);
  }

  has(keyId: string): boolean {
    return this.keys.has(keyId);
  }

  get size(): number {
    return this.keys.size;
  }

  ids(): string[] {
    return [...this.keys.keys()];
  }
}

function aad(secretId: string, field: string): Uint8Array<ArrayBuffer> {
  return buf(new TextEncoder().encode(`${secretId}\u0000${field}`));
}

/**
 * `mp1.<keyId>.<iv>.<ciphertext>`. The key id is in the clear so a reader knows
 * which key to use; it is a hash, and says nothing about the key.
 */
export async function sealField(
  key: VaultKey,
  secretId: string,
  field: string,
  plaintext: string,
): Promise<string> {
  if (plaintext === '') return '';
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv: buf(iv), additionalData: aad(secretId, field) },
      key.aes,
      buf(new TextEncoder().encode(plaintext)),
    ),
  );
  return [FIELD_PREFIX, key.keyId, toB64(iv), toB64(ct)].join('.');
}

/** Which key sealed an envelope, or null for an empty or foreign value. */
export function keyIdOf(envelope: string): string | null {
  const parts = envelope.split('.');
  return parts.length === 4 && parts[0] === FIELD_PREFIX ? parts[1] : null;
}

export class SealError extends Error {}

/**
 * Open an envelope. An empty string opens to empty (a cleared field). Throws a
 * `SealError` for an envelope under a key this device does not hold, or one
 * that fails authentication — which includes one moved from another field.
 */
export async function openField(
  keyring: Keyring,
  secretId: string,
  field: string,
  envelope: string,
): Promise<string> {
  if (envelope === '') return '';
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== FIELD_PREFIX) {
    throw new SealError('not an encrypted value');
  }
  const key = keyring.get(parts[1]);
  if (!key) throw new SealError('sealed under a key this device does not hold');
  try {
    const pt = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: buf(fromB64(parts[2])),
        additionalData: aad(secretId, field),
      },
      key.aes,
      buf(fromB64(parts[3])),
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new SealError('failed to authenticate');
  }
}

/** A fresh secret id, in the shape the contract requires. */
export function newSecretId(): string {
  return `secret_${toHex(randomBytes(16))}`;
}
