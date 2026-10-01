// ── Share one secret with someone outside the team ──────────────────────────
//
// A share link is SELF-CONTAINED: the secret travels inside the link, sealed,
// in the URL fragment (after `#`), which browsers never send to any server —
// not to the page host, not to a node. Nothing is written to the vault, so the
// recipient needs no node, no account and no invitation.
//
// Two ways to hold the key:
//   * in the link itself (`k=`): the link alone opens it;
//   * from a passphrase you tell them separately: the link alone is useless.
//
// Be honest about what an expiry can do. The link carries its own ciphertext,
// so there is no server to refuse a late request: the expiry is sealed INSIDE
// the payload and enforced by the page that opens it. It stops casual reuse of
// an old link; it cannot stop someone who already opened it from having
// copied the password. And a link cannot be revoked once sent — rotate the
// password if it went to the wrong place.

import { fromB64, randomBytes, toB64 } from './crypto';

export interface SharedSecret {
  name: string;
  kind: string;
  fields: Record<string, string>;
  /** ms since epoch. */
  expiresAt: number;
  sharedBy?: string;
}

const PASS_ITERATIONS = 600_000;

function b64url(bytes: Uint8Array): string {
  return toB64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function unb64url(text: string): Uint8Array {
  const std = text.replace(/-/g, '+').replace(/_/g, '/');
  return fromB64(std + '='.repeat((4 - (std.length % 4)) % 4));
}

async function passKey(pass: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pass),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new Uint8Array(salt),
      iterations: PASS_ITERATIONS,
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Build the fragment (everything after `#`). */
export async function createShareFragment(
  secret: SharedSecret,
  passphrase?: string,
): Promise<string> {
  const iv = randomBytes(12);
  const pt = new TextEncoder().encode(JSON.stringify(secret));
  if (passphrase) {
    const salt = randomBytes(16);
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        await passKey(passphrase, salt),
        pt,
      ),
    );
    return `v=1&p=1&s=${b64url(salt)}&iv=${b64url(iv)}&d=${b64url(ct)}`;
  }
  const raw = randomBytes(32);
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(raw),
    'AES-GCM',
    false,
    ['encrypt'],
  );
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      pt,
    ),
  );
  return `v=1&iv=${b64url(iv)}&d=${b64url(ct)}&k=${b64url(raw)}`;
}

export function shareUrl(
  fragment: string,
  origin = window.location.origin,
): string {
  return `${origin}/share#${fragment}`;
}

export function needsPassphrase(fragment: string): boolean {
  return new URLSearchParams(fragment).get('p') === '1';
}

export class ShareError extends Error {}

export async function openShareFragment(
  fragment: string,
  passphrase?: string,
  now = Date.now(),
): Promise<SharedSecret> {
  const q = new URLSearchParams(fragment.replace(/^#/, ''));
  if (q.get('v') !== '1')
    throw new ShareError('This is not a Mero Pass share link.');
  const iv = q.get('iv');
  const data = q.get('d');
  if (!iv || !data) throw new ShareError('This link is incomplete.');
  let key: CryptoKey;
  if (q.get('p') === '1') {
    const salt = q.get('s');
    if (!salt || !passphrase)
      throw new ShareError('This link needs a passphrase.');
    key = await passKey(passphrase, unb64url(salt));
  } else {
    const k = q.get('k');
    if (!k) throw new ShareError('This link is missing its key.');
    key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(unb64url(k)),
      'AES-GCM',
      false,
      ['decrypt'],
    );
  }
  let secret: SharedSecret;
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(unb64url(iv)) },
      key,
      new Uint8Array(unb64url(data)),
    );
    secret = JSON.parse(new TextDecoder().decode(pt)) as SharedSecret;
  } catch {
    throw new ShareError('Wrong passphrase, or the link was altered.');
  }
  if (now > secret.expiresAt) throw new ShareError('This link has expired.');
  return secret;
}
