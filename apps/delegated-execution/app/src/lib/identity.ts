/**
 * The device half of a password-free identity: an account root, a device
 * keypair, and the certificate that ties the two together.
 *
 * Everything here runs in the tab. Nothing in this file talks to a node, and
 * the two secrets it produces are never transmitted — which is the whole claim
 * the demo exists to make visible. What leaves the browser is a *credential*
 * (the account's signature over the device's public keys) and, later,
 * signatures made with the device key.
 *
 * ## Why two keys and not one
 *
 * The **root** is the account. It signs device certificates and nothing else in
 * this app, and losing it loses the account — there is no recovery path that
 * does not go through it or its 24-word phrase. The **device key** is what does
 * the day-to-day signing: login statements and warrants. Separating them is
 * what lets a device be revoked without the account being lost, and it is why
 * the root is kept in memory here while the device secret is persisted.
 *
 * ## The KEM key, and why it is generated but never used here
 *
 * A device certificate covers two keys: the ed25519 key it *signs* with and an
 * X25519 key a group key would be *delivered* to. This client never receives a
 * group key — it reads through a node's session and writes through a relay, and
 * both of those hold the key material — so the X25519 half is generated to make
 * a well-formed certificate and then sits unused. Substituting a placeholder
 * would produce a certificate that verifies today and strands the device the
 * moment anyone tries to deliver it a key.
 */

import {
  accountRootFromPhrase,
  accountRootFromSecret,
  generateAccountRoot,
  mintDeviceId,
  signDeviceCert,
  type AccountRoot,
  type RecoverableAccountRoot,
} from '@calimero-network/mero-js';

/** What this tab holds once it has an identity. */
export interface DeviceIdentity {
  /** The account these writes will be attributed to, 64 hex. */
  accountId: string;
  /** The device's replica id, 64 hex. */
  deviceId: string;
  /** The device's ed25519 signing secret, 64 hex. Signs statements and warrants. */
  deviceSecret: string;
  /** The device's ed25519 public key, 64 hex. */
  devicePublicKey: string;
  /**
   * The `AccountProof<DeviceCert>`, hex borsh.
   *
   * This is the only part of the identity that travels, and it is public by
   * construction: it proves the device belongs to the account and carries no
   * secret.
   */
  credential: string;
}

/** Hex-encode, lower case, no separators — the spelling every core API uses. */
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Thrown when the browser cannot do the cryptography this flow needs.
 *
 * Separated from a generic failure because the remedy is completely different:
 * nothing about the node, the account or the network is wrong, and retrying
 * will never help. Ed25519 and X25519 in WebCrypto are recent; a browser
 * without them cannot hold a Calimero device key at all.
 */
export class UnsupportedBrowserError extends Error {
  override name = 'UnsupportedBrowserError';
  constructor(algorithm: string) {
    super(
      `this browser's WebCrypto has no ${algorithm}, which a device key needs. ` +
        'Chrome 137+, Firefox 130+ or Safari 17+.',
    );
  }
}

/**
 * Generate the X25519 keypair a device certificate has to cover.
 *
 * Only the public half is returned: the private half is deliberately dropped,
 * because this client has no use for it (see the module note) and holding a
 * secret nothing reads is a liability rather than an asset.
 */
async function generateKemPublicKey(): Promise<string> {
  let pair: CryptoKeyPair;
  try {
    pair = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
  } catch {
    throw new UnsupportedBrowserError('X25519');
  }
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  return hex(new Uint8Array(raw));
}

/**
 * Mint the device's ed25519 signing key.
 *
 * An ed25519 secret *is* 32 random bytes, so there is no key-generation
 * ceremony — the only thing that can fail is deriving the public half, and that
 * failure means this browser's WebCrypto has no Ed25519 rather than anything
 * being wrong with the key. Derived through mero-js so the app has exactly one
 * derivation rather than two that could disagree about the same secret.
 *
 * `accountRootFromSecret` is the public derivation mero-js exposes; only its
 * `publicKey` is taken. The `accountId` it also computes describes the account
 * a *root* with these bytes would name, which this key is not — reading it here
 * would name an account nobody owns.
 */
async function deviceKeypair(): Promise<{ secret: string; publicKey: string }> {
  const secret = hex(crypto.getRandomValues(new Uint8Array(32)));
  try {
    const derived = await accountRootFromSecret(secret);
    return { secret, publicKey: derived.publicKey };
  } catch {
    throw new UnsupportedBrowserError('Ed25519');
  }
}

/**
 * Certify a fresh device against a root, returning what the tab keeps.
 *
 * `deviceEpoch` is 1 because this is the device's first certificate. The
 * projection refuses a link that does not strictly advance the epoch, so
 * re-certifying the same device later must pass a higher number — a detail this
 * demo does not exercise and deliberately does not hide behind a default of 0,
 * which would be inert.
 */
export async function certifyNewDevice(root: AccountRoot): Promise<DeviceIdentity> {
  const { secret, publicKey } = await deviceKeypair();
  const kemPublicKey = await generateKemPublicKey();

  const deviceId = await mintDeviceId(
    root.accountId,
    crypto.getRandomValues(new Uint8Array(16)),
  );

  const credential = await signDeviceCert({
    rootSecret: root.secret,
    device: deviceId,
    signPublicKey: publicKey,
    kemPublicKey,
    deviceEpoch: 1,
  });

  return {
    accountId: root.accountId,
    deviceId,
    deviceSecret: secret,
    devicePublicKey: publicKey,
    credential,
  };
}

/** Mint a brand-new account and its first device in one step. */
export async function createIdentity(): Promise<{
  root: RecoverableAccountRoot;
  device: DeviceIdentity;
}> {
  const root = await generateAccountRoot();
  return { root, device: await certifyNewDevice(root) };
}

/**
 * Restore an account from its phrase and certify a *new* device for it.
 *
 * Restoring does not recover the old device: its secret was never in the
 * phrase. That is the intended shape — a new device on a restored account is
 * exactly what "I lost my laptop" should produce.
 */
export async function restoreIdentity(phrase: string): Promise<{
  root: RecoverableAccountRoot;
  device: DeviceIdentity;
}> {
  const root = await accountRootFromPhrase(phrase);
  return { root, device: await certifyNewDevice(root) };
}
