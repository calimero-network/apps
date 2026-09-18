/**
 * Obtain a session with a device key this page cannot read.
 *
 * mero-js's `login()` does this already, and better in most respects, but its
 * config takes `deviceSecret` as 32 hex bytes — so using it requires the secret
 * to exist in script memory, which is the one thing this app exists to stop
 * being true. Every public entry point in mero-js 19.10 takes hex
 * (`WarrantInput.deviceSecret`, `signLoginStatement`'s `deviceSecret`,
 * `signDeviceCert`'s `rootSecret`); there is no signer hook to pass a
 * `CryptoKey` through. So the statement is reproduced here around a key that
 * can sign and can never be exported.
 *
 * The three legs, in order:
 *
 * 1. `GET /auth/challenge` — the node's freshness nonce.
 * 2. Sign a `LoginStatement` naming the node, this origin, that challenge and a
 *    freshly minted session key.
 * 3. `POST /auth/token` with the statement and the account proof beside it.
 *
 * ## The audience is where a reimplementation goes wrong
 *
 * It is the only field spelled differently in the two encodings, and neither
 * spelling looks wrong on its own:
 *
 * - in the **preimage** it contributes `tag ‖ body` as ONE part with no length
 *   inside it, because `domainHash` prefixes every part it is handed and a
 *   length here would be counted twice;
 * - on the **wire** it is a borsh enum: the tag, then for the two
 *   payload-carrying variants a borsh `String` — its own u32 length, then UTF-8.
 *
 * So the same audience is `00 ‖ utf8` in one place and `00 ‖ u32 ‖ utf8` in the
 * other, and `Cli` is a bare tag with neither. An implementation that
 * length-prefixes everywhere looks correct right up until someone logs in from
 * a browser. `login.test.ts` pins all three variants against core's vectors at
 * `crates/account/src/tests/login_wire_fixture.rs` for exactly that reason.
 *
 * ## What a statement does and does not prove
 *
 * It proves a device key asked for this session. It says nothing about which
 * account that key belongs to — the `AccountProof` travelling beside it is what
 * says that, and the node checks the two separately. Signing here and sending
 * no proof is a 401 that looks exactly like a bad signature.
 */

import { concat, domainHash, fromHex, hex, signEd25519, u32le, u64le, utf8 } from './bytes.js';
import type { DeviceHandle, EnrolledDevice } from './device.js';

const LOGIN_DOMAIN = utf8('calimero.auth.login.v1');

/** What mero-js uses, and what a node's default statement lifetime expects. */
const DEFAULT_TTL_SECONDS = 300;

/**
 * The client surface a session is bound to.
 *
 * A session minted for one surface cannot be presented from another, so a single
 * compromised surface does not yield sessions usable everywhere.
 */
export type Audience =
  | { kind: 'webOrigin'; origin: string }
  | { kind: 'codeSigningId'; id: string }
  | { kind: 'cli' };

/** The tag and payload a variant carries. Tags are core's, and are not ours to renumber. */
function audienceParts(audience: Audience): { tag: number; body: Uint8Array } {
  switch (audience.kind) {
    case 'webOrigin':
      return { tag: 0, body: utf8(audience.origin) };
    case 'codeSigningId':
      return { tag: 1, body: utf8(audience.id) };
    case 'cli':
      return { tag: 2, body: new Uint8Array(0) };
  }
}

/** `tag ‖ body`, with NO length — `domainHash` adds one, and two would not match. */
function audienceSigningBytes(audience: Audience): Uint8Array {
  const { tag, body } = audienceParts(audience);
  return concat(new Uint8Array([tag]), body);
}

/** The borsh enum: tag, then a borsh `String` for the variants that carry one. */
function audienceWireBytes(audience: Audience): Uint8Array {
  const { tag, body } = audienceParts(audience);
  if (audience.kind === 'cli') return new Uint8Array([tag]);
  return concat(new Uint8Array([tag]), u32le(body.length), body);
}

export interface LoginStatementInput {
  /**
   * The node this session is for, hex — its identity public key, as you pinned it.
   *
   * Must come from something you pinned out of band, never from the challenge
   * response and never from any field the node itself chose. A party who can
   * answer on the node's behalf would otherwise pick what your device signs
   * about, which is the whole reason the field exists.
   */
  node: string;
  audience: Audience;
  /** The challenge the node issued, hex. */
  challenge: string;
  /** The ephemeral key the session will speak with, hex. */
  sessionKey: string;
  /** Unix seconds at signing. */
  issuedAt: number | bigint;
  /** Unix seconds after which the node must refuse it. */
  expiresAt: number | bigint;
  /** The device's signing key — non-extractable, and the point of this module. */
  signingKey: CryptoKey;
  /** Its public half, hex; captured at generation since it cannot be re-derived. */
  devicePublicKey: string;
}

/**
 * Sign a login statement and return its wire encoding, hex.
 *
 * Returns the encoding rather than an object for the reason mero-js does: the
 * signature covers exactly these bytes, and a caller that rebuilt the fields
 * from JSON would hold a second spelling able to disagree with what was signed.
 */
export async function signLoginStatement(input: LoginStatementInput): Promise<string> {
  const node = fromHex(input.node, 'node', 32);
  const challenge = fromHex(input.challenge, 'challenge', 32);
  const sessionKey = fromHex(input.sessionKey, 'sessionKey', 32);
  const deviceKey = fromHex(input.devicePublicKey, 'devicePublicKey', 32);
  const issuedAt = u64le(input.issuedAt);
  const expiresAt = u64le(input.expiresAt);

  const preimage = await domainHash(LOGIN_DOMAIN, [
    node,
    audienceSigningBytes(input.audience),
    challenge,
    sessionKey,
    deviceKey,
    issuedAt,
    expiresAt,
  ]);

  const signature = await signEd25519(input.signingKey, preimage);

  return hex(
    concat(
      node,
      audienceWireBytes(input.audience),
      challenge,
      sessionKey,
      deviceKey,
      issuedAt,
      expiresAt,
      signature,
    ),
  );
}

/** What a session is, once the node has minted one. */
export interface DelegatedSession {
  /** The bearer token reads are made with. */
  accessToken: string;
  refreshToken: string;
  /** The session key the statement named, hex. */
  sessionKey: string;
}

/**
 * Mint the ephemeral key the session speaks with.
 *
 * Generated per session and thrown away with it, which is what keeps the device
 * key off the wire for the session's life. Non-extractable like the device key:
 * this client only ever needs to *name* it, because the node answers with a
 * bearer token rather than asking the session key to sign anything further.
 */
async function generateSessionKey(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  return hex(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
}

const trimmed = (url: string) => url.replace(/\/+$/, '');

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${url} answered ${response.status}: ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Obtain a session on a node this device does not own.
 *
 * The challenge is fetched immediately before signing, on purpose: it is
 * single-use and short-lived, and a statement signed against a stale one is a
 * 401 indistinguishable from a wrong key.
 */
export async function openSession(
  nodeUrl: string,
  nodeKey: string,
  device: EnrolledDevice,
  handle: DeviceHandle,
  audience: Audience = { kind: 'webOrigin', origin: window.location.origin },
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<DelegatedSession> {
  const base = trimmed(nodeUrl);

  // The node has spelled this both bare and wrapped in `data`; accept either
  // rather than couple a login to one envelope revision.
  const challengeBody = await call<{ challenge?: string; data?: { challenge?: string } }>(
    `${base}/auth/challenge`,
    { method: 'GET', headers: { Accept: 'application/json' } },
  );
  const challenge = challengeBody.challenge ?? challengeBody.data?.challenge;
  if (!challenge) throw new Error('the node issued no challenge');

  const sessionKey = await generateSessionKey();
  const issuedAt = Math.floor(Date.now() / 1000);

  const statement = await signLoginStatement({
    node: nodeKey,
    audience,
    challenge,
    sessionKey,
    issuedAt,
    expiresAt: issuedAt + ttlSeconds,
    signingKey: handle.signingKey,
    devicePublicKey: handle.devicePublicKey,
  });

  // `timestamp` is required and the request refuses unknown fields, so a body
  // missing it is rejected during deserialization — before the provider runs,
  // and with an error naming the request shape rather than the login.
  const tokenBody = await call<{
    access_token?: string;
    refresh_token?: string;
    data?: { access_token?: string; refresh_token?: string };
  }>(`${base}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      auth_method: 'account_proof',
      public_key: sessionKey,
      client_name: audience.kind === 'webOrigin' ? audience.origin : 'delegated-execution',
      timestamp: issuedAt,
      provider_data: {
        challenge,
        login_statement: statement,
        account_proof: device.credential,
      },
    }),
  });

  const accessToken = tokenBody.access_token ?? tokenBody.data?.access_token;
  if (!accessToken) throw new Error('the node minted no session');

  return {
    accessToken,
    refreshToken: tokenBody.refresh_token ?? tokenBody.data?.refresh_token ?? '',
    sessionKey,
  };
}
