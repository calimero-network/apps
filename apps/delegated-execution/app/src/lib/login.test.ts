/**
 * Conformance against core's own login vectors.
 *
 * Copied from `core/crates/account/src/tests/login_wire_fixture.rs`, which
 * exists because `AUTH_LOGIN_SIGN_DOMAIN` is `pub(crate)` there and the field
 * order is implicit in a `derive` — so nothing on that side forces anyone to
 * notice this file depends on both.
 *
 * All three audience variants are pinned rather than one. `Cli` carries no
 * payload and is the variant that makes a "length-prefix it everywhere"
 * implementation look correct; `WebOrigin` is the one a browser actually uses
 * and the one that would then be wrong. A drift here surfaces as a 401 at
 * login, indistinguishable from a wrong key.
 *
 * The fixture signs with `key(9)` — `PrivateKey::from([9u8; 32])`, deliberately
 * a different seed from the warrant fixture's `key(7)`, so a device key copied
 * from the wrong fixture is visible rather than coincidentally right.
 */

import { describe, expect, it } from 'vitest';

import { signLoginStatement, type Audience } from './login.js';

const NODE = '11'.repeat(32);
const CHALLENGE = '22'.repeat(32);
const SESSION = '33'.repeat(32);
const ISSUED_AT = 1_700_000_000;
const EXPIRES_AT = 1_700_000_300;

const WEB_ORIGIN = 'https://app.example:8443';
const CODE_SIGNING_ID = 'dev.calimero.client';

/** The public half the fixture's encoding names, from core's own dump. */
const FIXTURE_DEVICE_KEY = 'fd1724385aa0c75b64fb78cd602fa1d991fdebf76b13c58ed702eac835e9f618';

/** Ed25519 PKCS#8 prefix, so a raw 32-byte seed can be imported by WebCrypto. */
const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

async function fixtureKey(): Promise<CryptoKey> {
  const seed = new Uint8Array(32).fill(9);
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + seed.length);
  pkcs8.set(PKCS8_ED25519_PREFIX, 0);
  pkcs8.set(seed, PKCS8_ED25519_PREFIX.length);
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
}

async function statement(audience: Audience): Promise<string> {
  return signLoginStatement({
    node: NODE,
    audience,
    challenge: CHALLENGE,
    sessionKey: SESSION,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    signingKey: await fixtureKey(),
    devicePublicKey: FIXTURE_DEVICE_KEY,
  });
}

const WEB_ORIGIN_ENCODING =
  '1111111111111111111111111111111111111111111111111111111111111111' + // node
  '00' + // audience tag 0 = WebOrigin
  '18000000' + // borsh String: u32 LE length 24 — HERE and not in the preimage
  '68747470733a2f2f6170702e6578616d706c653a38343433' + // "https://app.example:8443"
  '2222222222222222222222222222222222222222222222222222222222222222' + // challenge
  '3333333333333333333333333333333333333333333333333333333333333333' + // session_key
  'fd1724385aa0c75b64fb78cd602fa1d991fdebf76b13c58ed702eac835e9f618' + // device_key
  '00f1536500000000' + // issued_at
  '2cf2536500000000' + // expires_at
  '8302e61afe8f61c8471bc5f8ae9ff13cdd5b3e9bcd793cf8c46acb3ff9592aa4' +
  '37c1aae1b1ee9c9514f29b2340d13a547ea5e6cd4b4b65fbf09bafb55f4c7e00';

const CLI_ENCODING =
  '1111111111111111111111111111111111111111111111111111111111111111' + // node
  '02' + // audience tag 2 = Cli, and nothing follows it
  '2222222222222222222222222222222222222222222222222222222222222222' + // challenge
  '3333333333333333333333333333333333333333333333333333333333333333' + // session_key
  'fd1724385aa0c75b64fb78cd602fa1d991fdebf76b13c58ed702eac835e9f618' + // device_key
  '00f1536500000000' +
  '2cf2536500000000' +
  '085b4ee049f7f268a35ec1bfdfe779b94f3bda66cbbb48937735f9ab10c0ef71' +
  'cad6f5bbb9afc4b2b87b5ee87d06284e3c5bc77a6c541c56e62aa65ace8fdb0b';

describe('login statement, against core’s fixture', () => {
  it('produces the web-origin encoding a browser actually sends', async () => {
    // The signature matching proves the preimage matched too: ed25519 is
    // deterministic, so a different preimage yields different bytes here — and
    // the preimage is where the audience's missing length prefix lives.
    expect(await statement({ kind: 'webOrigin', origin: WEB_ORIGIN })).toBe(WEB_ORIGIN_ENCODING);
  });

  it('is 237 bytes for a web origin — a different length means a field changed shape', async () => {
    expect((await statement({ kind: 'webOrigin', origin: WEB_ORIGIN })).length / 2).toBe(237);
  });

  it('writes Cli as a bare tag, with no count and no body', async () => {
    // 209, not 213: a u32 zero written here would be read as the first four
    // bytes of the challenge, and every field after it shifts.
    expect(await statement({ kind: 'cli' })).toBe(CLI_ENCODING);
    expect(CLI_ENCODING.length / 2).toBe(209);
  });

  it('writes CodeSigningId with its tag and length-prefixed body', async () => {
    const encoded = await statement({ kind: 'codeSigningId', id: CODE_SIGNING_ID });
    expect(encoded.length / 2).toBe(232);
    expect(encoded).toContain('01130000006465762e63616c696d65726f2e636c69656e74');
  });

  it('separates two audiences that differ only in their tag', async () => {
    // Held equal in the body, so the tag byte is the only thing left. Without
    // it, a session minted for a browser origin could be presented by a native
    // client spelling its identity the same way.
    const asOrigin = await statement({ kind: 'webOrigin', origin: CODE_SIGNING_ID });
    const asId = await statement({ kind: 'codeSigningId', id: CODE_SIGNING_ID });
    expect(asOrigin).not.toBe(asId);
  });

  it('refuses a malformed id rather than signing something meaningless', async () => {
    const signingKey = await fixtureKey();
    await expect(
      signLoginStatement({
        node: 'not-hex',
        audience: { kind: 'cli' },
        challenge: CHALLENGE,
        sessionKey: SESSION,
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
        signingKey,
        devicePublicKey: FIXTURE_DEVICE_KEY,
      }),
    ).rejects.toThrow(/node must be 64 hex/);
  });
});
