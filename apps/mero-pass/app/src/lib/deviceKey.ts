// ── This browser's device key, and the lock around it ───────────────────────
//
// One ECDH key pair per browser profile. Every vault key this device can open
// is wrapped to its public half, so whoever can USE the private half can read
// every vault this browser was admitted to. Two ways to keep it:
//
//   * No PIN (default). IndexedDB holds a NON-EXTRACTABLE CryptoKey: script on
//     this origin can use it but no code — including this one — can read its
//     bytes out, so a copied disk image or a synced profile does not carry it.
//   * With a PIN. IndexedDB holds only the pkcs8 bytes sealed under
//     AES-GCM(PBKDF2-SHA256(PIN, 600k)). Nothing usable is at rest; unlocking
//     derives the key, imports the private half as non-extractable, and keeps it
//     in memory only.
//
// Either way the in-memory copy is dropped by `lock()`, which the auto-lock
// timer calls. Unlocking a PIN-less device is a click; unlocking a PIN device
// needs the PIN.

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

type StoredDevice =
  | {
      kind: 'plain';
      privateKey: CryptoKey;
      publicRaw: Uint8Array;
      createdAt: number;
    }
  | {
      kind: 'pin';
      sealed: string;
      salt: string;
      iv: string;
      publicRaw: Uint8Array;
      createdAt: number;
    };

/** Minimal persistence seam, so the logic below is testable without IndexedDB. */
export interface DeviceStore {
  get(): Promise<StoredDevice | undefined>;
  put(value: StoredDevice): Promise<void>;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
  async put(value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, RECORD);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

async function pinKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
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

async function importPrivate(pkcs8: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    new Uint8Array(pkcs8),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
}

export class WrongPinError extends Error {
  constructor() {
    super('That PIN does not unlock this device.');
  }
}

/** The device key, and whether it is currently unlocked in memory. */
export class DeviceKeeper {
  private unlocked: DeviceKeyPair | null = null;
  private fp: string | null = null;
  private listeners = new Set<() => void>();

  constructor(private store: DeviceStore = indexedDbStore) {}

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

  /** Whether a PIN guards this device. */
  async hasPin(): Promise<boolean> {
    return (await this.store.get())?.kind === 'pin';
  }

  /**
   * Unlock without a PIN, creating the device key on first use. Throws
   * `WrongPinError` if a PIN is set (the caller should ask for it).
   */
  async unlock(pin?: string): Promise<DeviceKeyPair> {
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
      if (!pin) throw new WrongPinError();
      try {
        const key = await pinKey(pin, fromB64(stored.salt));
        const pkcs8 = new Uint8Array(
          await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(fromB64(stored.iv)) },
            key,
            new Uint8Array(fromB64(stored.sealed)),
          ),
        );
        pair = {
          privateKey: await importPrivate(pkcs8),
          publicRaw: stored.publicRaw,
        };
        pkcs8.fill(0);
      } catch {
        throw new WrongPinError();
      }
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

  /**
   * Put a PIN on this device.
   *
   * A non-extractable key cannot be sealed, so setting a PIN mints a NEW device
   * key (extractable just long enough to seal it) and returns its fingerprint.
   * The caller must register the new key in every vault and have a key holder
   * wrap to it — the old key's wraps stop being reachable from this browser.
   */
  async setPin(pin: string): Promise<string> {
    if (pin.length < 4) throw new Error('Use at least 4 characters.');
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
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        await pinKey(pin, salt),
        pkcs8,
      ),
    );
    await this.store.put({
      kind: 'pin',
      sealed: toB64(sealed),
      salt: toB64(salt),
      iv: toB64(iv),
      publicRaw,
      createdAt: Date.now(),
    });
    this.unlocked = { privateKey: await importPrivate(pkcs8), publicRaw };
    pkcs8.fill(0);
    this.fp = await fingerprintOf(publicRaw);
    this.emit();
    return this.fp;
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
