// ── This browser's device key, and the lock around it ───────────────────────
//
// One ECDH key pair per browser profile. Every vault key this device can open
// is wrapped to its public half, so whoever can USE the private half can read
// every vault this browser was admitted to. Three ways to keep it:
//
//   * Unprotected (default). IndexedDB holds a NON-EXTRACTABLE CryptoKey:
//     script on this origin can use it but no code — including this one — can
//     read its bytes out, so a copied disk image or a synced profile does not
//     carry it. Anyone at the unlocked computer can open it, though.
//   * Passphrase. IndexedDB holds only the pkcs8 bytes sealed under
//     AES-GCM(PBKDF2-SHA256(passphrase, 600k)). Nothing usable is at rest.
//   * Passkey. The same sealing, under a key the authenticator derives with
//     the WebAuthn PRF extension: unlocking is Touch ID, Windows Hello or a
//     security key, and the sealing key never exists outside the
//     authenticator until it is asked, with user verification, for it.
//
// Either sealed way, unlocking imports the private half as non-extractable
// and keeps it in memory only; `lock()`, which the auto-lock timer calls,
// drops it. Protecting a device mints a new key pair (a non-extractable key
// cannot be sealed) and hands every vault key over to it first.

import {
  type DeviceKeyPair,
  fingerprintOf,
  fromB64,
  generateDeviceKey,
  randomBytes,
  toB64,
} from './crypto';

const DB_NAME = 'mero-pass';
const STORE = 'device';
const RECORD = 'default';
const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE = 8;
const PRF_INFO = new TextEncoder().encode('mero-pass/passkey-seal/v1');

export type Protection = 'none' | 'passphrase' | 'passkey';

type StoredDevice =
  | {
      kind: 'plain';
      privateKey: CryptoKey;
      publicRaw: Uint8Array;
      createdAt: number;
    }
  | {
      kind: 'sealed';
      by: 'passphrase' | 'passkey';
      sealed: string;
      /** PBKDF2 salt, or the PRF input. */
      salt: string;
      iv: string;
      /** The passkey's credential id, for `by: 'passkey'`. */
      credentialId?: string;
      publicRaw: Uint8Array;
      createdAt: number;
    };

/** Minimal persistence seam, so the logic below is testable without IndexedDB. */
export interface DeviceStore {
  get(): Promise<StoredDevice | undefined>;
  put(value: StoredDevice): Promise<void>;
  clear(): Promise<void>;
}

/**
 * The WebAuthn seam: create a passkey, and ask it for its PRF output on a
 * salt. Both need a user gesture and user verification.
 */
export interface PasskeyProvider {
  create(): Promise<{ credentialId: Uint8Array }>;
  prf(credentialId: Uint8Array, salt: Uint8Array): Promise<Uint8Array>;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function write(fn: (s: IDBObjectStore) => void): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export const indexedDbStore: DeviceStore = {
  async get() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(STORE, 'readonly')
        .objectStore(STORE)
        .get(RECORD);
      req.onsuccess = () => resolve(req.result as StoredDevice | undefined);
      req.onerror = () => reject(req.error);
    });
  },
  put: (value) => write((s) => s.put(value, RECORD)),
  clear: () => write((s) => s.delete(RECORD)),
};

// ── WebAuthn PRF ────────────────────────────────────────────────────────────

/** The PRF extension's shapes, which lib.dom does not type yet. */
interface PrfResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

export class PasskeyUnsupportedError extends Error {
  constructor() {
    super(
      'This browser or authenticator cannot derive keys from a passkey (WebAuthn PRF).',
    );
  }
}

export const webAuthnPasskeys: PasskeyProvider = {
  async create() {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'Mero Pass' },
        user: {
          id: randomBytes(16),
          name: 'Mero Pass device key',
          displayName: 'Mero Pass device key',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'required',
        },
        extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    if (!cred) throw new PasskeyUnsupportedError();
    const ext = cred.getClientExtensionResults() as PrfResults;
    if (!ext.prf?.enabled) throw new PasskeyUnsupportedError();
    return { credentialId: new Uint8Array(cred.rawId) };
  },
  async prf(credentialId, salt) {
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [
          { type: 'public-key', id: new Uint8Array(credentialId) },
        ],
        userVerification: 'required',
        extensions: {
          prf: { eval: { first: new Uint8Array(salt) } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    const first = (cred?.getClientExtensionResults() as PrfResults | undefined)
      ?.prf?.results?.first;
    if (!first) throw new PasskeyUnsupportedError();
    return new Uint8Array(first);
  },
};

// ── Sealing keys ────────────────────────────────────────────────────────────

async function passphraseKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new Uint8Array(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** HKDF over the PRF output, so the authenticator's bytes are never the key. */
async function prfKey(
  output: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(output),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(salt),
      info: PRF_INFO,
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function importPrivate(pkcs8: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    new Uint8Array(pkcs8),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
}

export class WrongPassphraseError extends Error {
  constructor(message = 'That passphrase does not unlock this device.') {
    super(message);
  }
}

type HandOver = (next: DeviceKeyPair, nextFingerprint: string) => Promise<void>;

/** The device key, and whether it is currently unlocked in memory. */
export class DeviceKeeper {
  private unlocked: DeviceKeyPair | null = null;
  private fp: string | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private store: DeviceStore = indexedDbStore,
    private passkeys: PasskeyProvider = webAuthnPasskeys,
  ) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  get isUnlocked(): boolean {
    return this.unlocked !== null;
  }

  /** The unlocked key pair, or null while locked. */
  get device(): DeviceKeyPair | null {
    return this.unlocked;
  }

  get fingerprint(): string | null {
    return this.fp;
  }

  /** What guards this device's key at rest. */
  async protection(): Promise<Protection> {
    const stored = await this.store.get();
    return stored?.kind === 'sealed' ? stored.by : 'none';
  }

  /**
   * Unlock, creating the device key on first use. A passphrase device needs
   * `passphrase` (else `WrongPassphraseError`); a passkey device asks the
   * authenticator, so call this from a click.
   */
  async unlock(passphrase?: string): Promise<DeviceKeyPair> {
    const stored = await this.store.get();
    let pair: DeviceKeyPair;
    if (!stored) {
      pair = await generateDeviceKey();
      await this.store.put({
        kind: 'plain',
        privateKey: pair.privateKey,
        publicRaw: pair.publicRaw,
        createdAt: Date.now(),
      });
    } else if (stored.kind === 'plain') {
      pair = { privateKey: stored.privateKey, publicRaw: stored.publicRaw };
    } else {
      const salt = fromB64(stored.salt);
      let key: CryptoKey;
      if (stored.by === 'passkey') {
        const out = await this.passkeys.prf(
          fromB64(stored.credentialId ?? ''),
          salt,
        );
        key = await prfKey(out, salt);
        out.fill(0);
      } else {
        if (!passphrase) throw new WrongPassphraseError();
        key = await passphraseKey(passphrase, salt);
      }
      let pkcs8: Uint8Array;
      try {
        pkcs8 = new Uint8Array(
          await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(fromB64(stored.iv)) },
            key,
            new Uint8Array(fromB64(stored.sealed)),
          ),
        );
      } catch {
        throw new WrongPassphraseError(
          stored.by === 'passkey'
            ? 'That passkey does not unlock this device.'
            : undefined,
        );
      }
      pair = {
        privateKey: await importPrivate(pkcs8),
        publicRaw: stored.publicRaw,
      };
      pkcs8.fill(0);
    }
    this.unlocked = pair;
    this.fp = await fingerprintOf(pair.publicRaw);
    this.emit();
    return pair;
  }

  /** Drop the in-memory key. Every vault keyring must be dropped with it. */
  lock(): void {
    this.unlocked = null;
    this.emit();
  }

  /** Protect this device with a passphrase of at least `MIN_PASSPHRASE`. */
  async setPassphrase(passphrase: string, handOver: HandOver): Promise<string> {
    if (passphrase.length < MIN_PASSPHRASE)
      throw new Error(`Use at least ${MIN_PASSPHRASE} characters.`);
    const salt = randomBytes(16);
    return this.reseal(
      { by: 'passphrase', salt },
      await passphraseKey(passphrase, salt),
      handOver,
    );
  }

  /** Protect this device with a passkey. Call from a click. */
  async setPasskey(handOver: HandOver): Promise<string> {
    const { credentialId } = await this.passkeys.create();
    const salt = randomBytes(32);
    const out = await this.passkeys.prf(credentialId, salt);
    const key = await prfKey(out, salt);
    out.fill(0);
    return this.reseal(
      { by: 'passkey', salt, credentialId: toB64(credentialId) },
      key,
      handOver,
    );
  }

  /**
   * Mint a new device key, seal it under `key`, and store it.
   *
   * ⚠️ `handOver` RUNS BEFORE THE NEW KEY REPLACES THE OLD ONE, and must move
   * every vault key the old device holds onto the new one (`migrateDevice`).
   * The old key is gone once this returns, so for a personal vault used from
   * one browser a skipped hand-over is a vault nobody can open again. If it
   * throws, nothing is stored and the old key stays.
   */
  private async reseal(
    how: {
      by: 'passphrase' | 'passkey';
      salt: Uint8Array;
      credentialId?: string;
    },
    key: CryptoKey,
    handOver: HandOver,
  ): Promise<string> {
    const pair = (await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    )) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(
      await crypto.subtle.exportKey('pkcs8', pair.privateKey),
    );
    const publicRaw = new Uint8Array(
      await crypto.subtle.exportKey('raw', pair.publicKey),
    );
    const iv = randomBytes(12);
    try {
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: new Uint8Array(iv) },
          key,
          pkcs8,
        ),
      );
      const next: DeviceKeyPair = {
        privateKey: await importPrivate(pkcs8),
        publicRaw,
      };
      const nextFp = await fingerprintOf(publicRaw);
      await handOver(next, nextFp);
      await this.store.put({
        kind: 'sealed',
        by: how.by,
        sealed: toB64(sealed),
        salt: toB64(how.salt),
        iv: toB64(iv),
        credentialId: how.credentialId,
        publicRaw,
        createdAt: Date.now(),
      });
      this.unlocked = next;
      this.fp = nextFp;
      this.emit();
      return nextFp;
    } finally {
      pkcs8.fill(0);
    }
  }

  /**
   * Forget this browser's device key. For a forgotten passphrase or a lost
   * passkey: the next unlock makes a fresh, unprotected key, which has to be
   * approved, or restored with a recovery key, to open anything again.
   */
  async reset(): Promise<void> {
    await this.store.clear();
    this.unlocked = null;
    this.fp = null;
    this.emit();
  }
}

/** The one keeper for this browser tab. */
export const deviceKeeper = new DeviceKeeper();

/** A short label for the device list: browser and platform, nothing unique. */
export function deviceLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const browser = /Firefox\//.test(ua)
    ? 'Firefox'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Mac OS X/.test(ua)
    ? 'macOS'
    : /Windows/.test(ua)
      ? 'Windows'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}
