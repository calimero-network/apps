/**
 * A device key this page can use and cannot read.
 *
 * The demo's original identity keeps an ed25519 secret — and the account root —
 * as hex in `localStorage`, and says plainly that a product must not. This
 * module is the other half of that sentence: the signing key is generated
 * non-extractable, lives in IndexedDB as a `CryptoKey`, and never exists as
 * bytes in script memory. Injected script on this origin can still *spend*
 * warrants while the page is open, which is the residual the design accepts;
 * what it can no longer do is walk away with the identity.
 *
 * ## What is not here, deliberately
 *
 * **The account root.** A root in the browser was the compromise; keeping it
 * non-extractable would not fix it, because a certificate has to be signed
 * somewhere the root actually is. So this module holds no root and mints no
 * certificate: it produces a public key, and something else — a CLI holding the
 * root offline, or an Auth app holding it in hardware — signs the
 * `AccountProof<DeviceCert>` that comes back as {@link EnrolledDevice.credential}.
 *
 * **A re-derivable public key.** `crypto.subtle.exportKey` refuses a
 * non-extractable private key, and mero-js's `derivePublicKey` needs an
 * extractable one, so the public half is captured at generation and stored
 * beside the handle. Losing it means losing the ability to name the key, not
 * just to use it.
 */

const DB_NAME = 'calimero.delegated-demo';
const STORE = 'kv';
const DEVICE_KEY = 'device.key';
const DEVICE_META = 'device.meta';

/** What travels, and what a warrant names. No secret appears here. */
export interface EnrolledDevice {
  /** The account these writes are attributed to, 64 hex. */
  accountId: string;
  /** The device's replica id, 64 hex. */
  deviceId: string;
  /** The device's ed25519 public key, 64 hex. */
  devicePublicKey: string;
  /**
   * The `AccountProof<DeviceCert>`, hex borsh, signed by a root this browser
   * never saw. Until it arrives the key is real but speaks for nobody.
   */
  credential: string;
}

/** The private half: usable, unreadable, and never serialised. */
export interface DeviceHandle {
  signingKey: CryptoKey;
  devicePublicKey: string;
  /**
   * The X25519 key a wrapped group key would be delivered to, hex.
   *
   * A device certificate covers two keys, and this client never receives a
   * group key — it reads through a session and writes through a relay, both of
   * which hold the key material. The X25519 half is generated anyway, because
   * substituting a placeholder produces a certificate that verifies today and
   * strands the device the moment anyone tries to deliver it a key. Its private
   * half is deliberately dropped: holding a secret nothing reads is a liability.
   */
  kemPublicKey: string;
}

export class UnsupportedBrowserError extends Error {
  override name = 'UnsupportedBrowserError';
  constructor(algorithm: string) {
    super(
      `this browser's WebCrypto has no ${algorithm}, which a device key needs. ` +
        'Chrome 137+, Firefox 130+ or Safari 17+.',
    );
  }
}

function idb<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve((req && 'result' in req ? (req.result as T) : undefined) as T);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate this browser's device key, or return the one it already has.
 *
 * A `CryptoKey` survives IndexedDB by structured clone, so the handle is stored
 * directly — there is no serialisation step that could leak the private half,
 * because there is no representation of it to leak.
 */
export async function deviceHandle(): Promise<DeviceHandle> {
  const existing = await idb<DeviceHandle | undefined>('readonly', (s) => s.get(DEVICE_KEY));
  if (existing) return existing;

  let pair: CryptoKeyPair;
  try {
    // `extractable: false` on the pair: the private half can never be exported,
    // which is the entire difference between this and the demo's hex secret.
    pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
  } catch {
    throw new UnsupportedBrowserError('Ed25519');
  }

  // The public half is exportable even when the private half is not, but only
  // while we hold the pair — so capture it now rather than re-deriving later.
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));

  let kem: CryptoKeyPair;
  try {
    kem = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
  } catch {
    throw new UnsupportedBrowserError('X25519');
  }
  const kemRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kem.publicKey));

  const handle: DeviceHandle = {
    signingKey: pair.privateKey,
    devicePublicKey: hex(raw),
    kemPublicKey: hex(kemRaw),
  };
  await idb('readwrite', (s) => s.put(handle, DEVICE_KEY));
  return handle;
}

/** The public record of an enrolled device, if this browser has one. */
export async function enrolled(): Promise<EnrolledDevice | null> {
  const found = await idb<EnrolledDevice | undefined>('readonly', (s) => s.get(DEVICE_META));
  return found ?? null;
}

/**
 * Record what enrollment returned.
 *
 * Refuses a credential for a different key: a certificate that certifies some
 * other device would verify perfectly and vouch for a key this browser cannot
 * sign with, which surfaces later as an unspendable warrant.
 */
export async function recordEnrollment(device: EnrolledDevice): Promise<void> {
  const handle = await deviceHandle();
  if (device.devicePublicKey !== handle.devicePublicKey) {
    throw new Error('that credential certifies a different device key than this browser holds');
  }
  await idb('readwrite', (s) => s.put(device, DEVICE_META));
}

/** Forget the device entirely — the key included, since it cannot be re-derived. */
export async function forgetDevice(): Promise<void> {
  await idb('readwrite', (s) => s.delete(DEVICE_KEY));
  await idb('readwrite', (s) => s.delete(DEVICE_META));
}
