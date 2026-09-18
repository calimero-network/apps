/**
 * Conformance against core's own vectors.
 *
 * The bytes below are not this file's opinion: they are copied from
 * `core/crates/account/src/tests/warrant_wire_fixture.rs`, which exists because
 * the constants a non-Rust signer depends on (`WARRANT_SIGN_DOMAIN`,
 * `WARRANT_INTENT_DOMAIN`) are `pub(crate)` and the field order is implicit in a
 * `derive` — so nothing on that side forces anyone to notice this file exists.
 *
 * If these fail, `warrant.ts` is wrong and every warrant it mints is refused at
 * a relay as a 403: an authorization error, nowhere near its cause.
 *
 * The fixture signs with `key(7)` — `PrivateKey::from([7u8; 32])`, a raw ed25519
 * seed. Reproducing its signature needs that seed as a `CryptoKey`, which is
 * also the point: the signer takes a key, so a seed imported here and a
 * non-extractable key generated in the browser go down the identical path.
 */

import { describe, expect, it } from 'vitest';

import { hex, intentHash, signWarrant } from './warrant';

const METHOD = 'set';
const ARGS = { key: 'k', value: 'v' };

/** Ed25519 PKCS#8 prefix, so a raw 32-byte seed can be imported by WebCrypto. */
const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

async function fixtureKey(): Promise<CryptoKey> {
  const seed = new Uint8Array(32).fill(7);
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + seed.length);
  pkcs8.set(PKCS8_ED25519_PREFIX, 0);
  pkcs8.set(seed, PKCS8_ED25519_PREFIX.length);
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
}

/** The public half the fixture's encoding names, taken from core's own dump. */
const FIXTURE_DEVICE_KEY = 'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c';

const FIXTURE_ENCODING =
  '1111111111111111111111111111111111111111111111111111111111111111' + // context
  '2222222222222222222222222222222222222222222222222222222222222222' + // author_account
  'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c' + // author_device_key
  '3333333333333333333333333333333333333333333333333333333333333333' + // executor
  '4444444444444444444444444444444444444444444444444444444444444444' + // app_version
  '03000000' + // method: u32 LE length
  '736574' + // "set"
  'dc066cc8524c74dc21714174009df536376e3151f5b92f0a676defde599dbae5' + // intent_hash
  '01000000' + // account_heads: u32 LE count
  '5555555555555555555555555555555555555555555555555555555555555555' +
  '01000000' + // governance_floor: u32 LE count
  '6666666666666666666666666666666666666666666666666666666666666666' +
  '2a00000000000000' + // nonce 42, u64 LE
  '00f1536500000000' + // not_after 1_700_000_000, u64 LE
  '4007d4164a6a15f4b6b251b45e9afad623c274451127afc1453e35667d4ec6fe' + // signature
  '7aa8daa223c5320823c61612058c8053dcff9b361ced58bed5f05f4114099a06';

async function fixtureWarrant(): Promise<string> {
  return signWarrant({
    context: '11'.repeat(32),
    authorAccount: '22'.repeat(32),
    executor: '33'.repeat(32),
    appVersion: '44'.repeat(32),
    method: METHOD,
    argsJson: ARGS,
    accountHeads: ['55'.repeat(32)],
    governanceFloor: ['66'.repeat(32)],
    nonce: 42n,
    notAfter: 1_700_000_000n,
    signingKey: await fixtureKey(),
    devicePublicKey: FIXTURE_DEVICE_KEY,
  });
}

describe('warrant, against core’s fixture', () => {
  it('computes the intent hash core computes', async () => {
    expect(hex(await intentHash(METHOD, ARGS))).toBe(
      'dc066cc8524c74dc21714174009df536376e3151f5b92f0a676defde599dbae5',
    );
  });

  it('produces the exact wire encoding, signature included', async () => {
    // The signature matching proves the preimage matched too: ed25519 is
    // deterministic, so a different preimage yields different bytes here.
    expect(await fixtureWarrant()).toBe(FIXTURE_ENCODING);
  });

  it('is 351 bytes — a different length means a field changed shape', async () => {
    expect((await fixtureWarrant()).length / 2).toBe(351);
  });

  it('commits to the method/args split, so it cannot be shifted', async () => {
    const a = hex(await intentHash('ab', { x: 1 }));
    const b = hex(await intentHash('a', { x: 1 }));
    expect(a).not.toBe(b);
  });

  it('refuses more cited heads than a node accepts', async () => {
    await expect(
      signWarrant({
        context: '11'.repeat(32),
        authorAccount: '22'.repeat(32),
        executor: '33'.repeat(32),
        method: METHOD,
        argsJson: ARGS,
        accountHeads: Array.from({ length: 65 }, () => '55'.repeat(32)),
        nonce: 1n,
        notAfter: 1_700_000_000n,
        signingKey: await fixtureKey(),
        devicePublicKey: FIXTURE_DEVICE_KEY,
      }),
    ).rejects.toThrow(/over the 64/);
  });

  it('refuses a malformed id rather than signing something meaningless', async () => {
    await expect(
      signWarrant({
        context: 'not-hex',
        authorAccount: '22'.repeat(32),
        executor: '33'.repeat(32),
        method: METHOD,
        argsJson: ARGS,
        nonce: 1n,
        notAfter: 1_700_000_000n,
        signingKey: await fixtureKey(),
        devicePublicKey: FIXTURE_DEVICE_KEY,
      }),
    ).rejects.toThrow(/context must be 64 hex/);
  });
});
