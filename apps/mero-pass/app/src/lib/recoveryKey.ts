// ── The recovery key: one more "device", kept on paper ──────────────────────
//
// A P-256 key pair like a browser's, except that its private half is shown to
// the user once, as a code, and then forgotten. It is registered in each vault
// as a `recovery` device and handed every vault key, so whoever holds the code
// can open those vaults from a browser that has nothing else: the code rebuilds
// the private key, the private key opens its wraps, and the vault keys are
// handed over to the new browser.
//
// The code is Crockford base32 of the private scalar `d` (32 bytes) and the
// first 3 bytes of the key's fingerprint, 56 characters in groups of 4. The
// fingerprint bytes pick out which registered recovery device the code belongs
// to; WebCrypto cannot derive a public key from `d`, so restoring takes the
// public half (`x`, `y`) from that registration.
//
// The code is the whole secret. Anyone who reads it can do what the restore
// flow does, so it belongs on paper or in another password manager, not in a
// file next to the browser.

import {
  type DeviceKeyPair,
  fingerprintOf,
  fromB64,
  toB64,
  toHex,
} from './crypto';
import { type DeviceRecord, VaultSession } from './vaultSession';
import { type StatusFn, forEachJoinedVault, forEachOpenVault } from './vaults';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_BYTES = 35;
const PREFIX_BYTES = 3;
const STORAGE_KEY = 'mero-pass:recovery-key';

export class RecoveryCodeError extends Error {}

export function encodeRecoveryCode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

/** Case, dashes and spaces are ignored; O reads as 0, I and L as 1. */
export function decodeRecoveryCode(text: string): Uint8Array {
  const clean = text
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (clean.length !== Math.ceil((CODE_BYTES * 8) / 5))
    throw new RecoveryCodeError('A recovery code has 56 characters.');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new RecoveryCodeError(`"${c}" is not in a recovery code.`);
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function b64url(bytes: Uint8Array): string {
  return toB64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return fromB64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

export interface RecoveryPublic {
  publicRaw: Uint8Array;
  fingerprint: string;
}

/** A new recovery key: the code to show once, and the public half to keep. */
export async function createRecoveryKey(): Promise<
  RecoveryPublic & { code: string }
> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', pair.publicKey),
  );
  const fingerprint = await fingerprintOf(publicRaw);
  const d = fromB64url(jwk.d!);
  const bytes = new Uint8Array(CODE_BYTES);
  bytes.set(d);
  bytes.set(hexBytes(fingerprint.slice(0, PREFIX_BYTES * 2)), d.length);
  const code = encodeRecoveryCode(bytes);
  d.fill(0);
  bytes.fill(0);
  return { code, publicRaw, fingerprint };
}

function hexBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

/**
 * Rebuild the recovery key pair from its code and the registered device it
 * belongs to. Null when no candidate matches, or the code's scalar does not
 * belong to that public key.
 */
export async function recoveryPairFrom(
  code: string,
  candidates: Pick<DeviceRecord, 'fingerprint' | 'public_key' | 'kind'>[],
): Promise<{ device: DeviceKeyPair; fingerprint: string } | null> {
  const bytes = decodeRecoveryCode(code);
  const prefix = toHex(bytes.slice(32));
  const d = bytes.slice(0, 32);
  for (const c of candidates) {
    if (c.kind !== 'recovery' || !c.fingerprint.startsWith(prefix)) continue;
    const raw = fromB64(c.public_key);
    if (raw.length !== 65 || raw[0] !== 4) continue;
    try {
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        {
          kty: 'EC',
          crv: 'P-256',
          d: b64url(d),
          x: b64url(raw.slice(1, 33)),
          y: b64url(raw.slice(33)),
        },
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        ['deriveBits'],
      );
      return {
        device: { privateKey, publicRaw: raw },
        fingerprint: c.fingerprint,
      };
    } catch {
      // Not this key: an import that validates the point refuses a mismatch.
    }
  }
  return null;
}

// ── The public half, remembered so vaults opened later get it too ───────────

export function rememberedRecoveryKey(): RecoveryPublic | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { fingerprint: string; publicKey: string };
    return { fingerprint: v.fingerprint, publicRaw: fromB64(v.publicKey) };
  } catch {
    return null;
  }
}

export function rememberRecoveryKey(key: RecoveryPublic): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        fingerprint: key.fingerprint,
        publicKey: toB64(key.publicRaw),
      }),
    );
  } catch {
    // Private mode: vaults opened later just will not get it automatically.
  }
}

// ── Across every vault ──────────────────────────────────────────────────────

type Mero = Parameters<typeof forEachJoinedVault>[0];

/**
 * Create a recovery key and give it every vault key this browser holds, in
 * every joined vault. Replaces this account's previous recovery key in each.
 * Returns the code, to show exactly once, and how many vaults it covers.
 */
export async function setUpRecoveryKey(
  mero: Mero,
  applicationId: string,
  browser: { device: DeviceKeyPair; fingerprint: string },
  label: string,
  onStatus?: StatusFn,
): Promise<{ code: string; vaults: number }> {
  const key = await createRecoveryKey();
  const vaults = await forEachOpenVault(
    mero,
    applicationId,
    browser,
    label,
    async (session) =>
      (await session.adoptRecoveryKey(key, true)) > 0 ? 1 : 0,
    onStatus,
  );
  rememberRecoveryKey(key);
  return { code: key.code, vaults };
}

/**
 * From a browser that holds nothing: rebuild the recovery key from `code` and
 * hand every vault key it can open to this browser. Returns how many vaults
 * were restored; throws when the code matches no recovery key at all.
 */
export async function restoreFromRecoveryKey(
  mero: Mero,
  applicationId: string,
  code: string,
  browser: { device: DeviceKeyPair; fingerprint: string },
  label: string,
  onStatus?: StatusFn,
): Promise<number> {
  decodeRecoveryCode(code);
  let found: RecoveryPublic | null = null;
  const restored = await forEachJoinedVault(
    mero,
    applicationId,
    async (api) => {
      const pair = await recoveryPairFrom(
        code,
        (await api.listDevices()).filter((d) => !d.revoked),
      );
      if (!pair) return 0;
      found = {
        publicRaw: pair.device.publicRaw,
        fingerprint: pair.fingerprint,
      };
      const recovery = new VaultSession(api, pair.device, pair.fingerprint, '');
      if ((await recovery.refreshKeys()) !== 'ready') return 0;
      await recovery.handOver(
        browser.device,
        browser.fingerprint,
        label,
        'browser',
      );
      return 1;
    },
    onStatus,
  );
  if (!found)
    throw new RecoveryCodeError(
      'That code does not match a recovery key in any vault on this node.',
    );
  if (restored === 0)
    throw new RecoveryCodeError(
      'That code did not open any vault. Check it for typos.',
    );
  rememberRecoveryKey(found);
  return restored;
}
