/**
 * Mint a warrant with a key this page cannot read.
 *
 * mero-js's `signWarrant` takes `deviceSecret` as 32 hex bytes, so the secret has
 * to exist in script memory to be passed at all. That is the one thing this app
 * is trying to stop being true: a key in `localStorage` is one XSS away from
 * being someone else's account forever. A non-extractable `CryptoKey` can sign
 * and can never be read, so script injected into this origin can spend warrants
 * while the page is open and cannot take the identity with it.
 *
 * So the encoding is reproduced here and the signing key is passed in. The
 * arithmetic is byte-for-byte what mero-js does — deliberately, because the
 * contract belongs to core, not to either implementation:
 *
 * - signing domain `calimero.warrant.v2`, intent domain `calimero.warrant.intent.v1`
 * - the preimage hashes cited-head **counts as u64**, while the wire encoding
 *   writes them **as u32** — same numbers, different width, and swapping them
 *   produces a warrant that is well-formed and verifies nowhere
 * - `not_after` and `nonce` are u64 little-endian in both
 *
 * `warrant.test.ts` pins all of it against the vectors in core at
 * `crates/account/src/tests/warrant_wire_fixture.rs`. If those fail, this file
 * is wrong and every warrant it mints will be refused at a relay as a 403 —
 * an authorization error nowhere near its cause.
 */

import { concat, domainHash, fromHex, hex, signEd25519, u32le, u64le, utf8 } from './bytes.js';

// Re-exported because this module's callers and its test already import them
// from here, and because the spelling belongs to the byte layer either way.
export { fromHex, hex };

const SIGN_DOMAIN = utf8('calimero.warrant.v2');
const INTENT_DOMAIN = utf8('calimero.warrant.intent.v1');

/** Most cited heads a node accepts per field, mirroring `MAX_WARRANT_CITED_HEADS`. */
const MAX_CITED_HEADS = 64;

/** 32 zero bytes: "no application pinned", the same default `merod` uses. */
const UNPINNED_APP = '00'.repeat(32);

/**
 * What a warrant commits to instead of the intent itself.
 *
 * Its own domain, distinct from the signing one, so a value computed for one
 * purpose cannot be presented for the other.
 */
export async function intentHash(method: string, argsJson: unknown): Promise<Uint8Array> {
  return domainHash(INTENT_DOMAIN, [utf8(method), utf8(JSON.stringify(argsJson))]);
}

function citedHeads(heads: string[] | undefined, label: string): Uint8Array[] {
  const list = heads ?? [];
  if (list.length > MAX_CITED_HEADS) {
    throw new Error(`${label} cites ${list.length} heads, over the ${MAX_CITED_HEADS} a node accepts`);
  }
  return list.map((head, i) => fromHex(head, `${label}[${i}]`, 32));
}

export interface WarrantInput {
  /** The context the intent runs in, hex. */
  context: string;
  /** Whose consent this is, hex. */
  authorAccount: string;
  /** The relay authorised to act — an account, not a key, hex. */
  executor: string;
  /**
   * The application build this warrant is signed against, hex.
   *
   * Nothing verifies it yet, but a warrant minted with the default will be
   * refused once pinning lands, so pass the context's real `applicationId`.
   */
  appVersion?: string;
  /** The method the relay may run, carried in the clear as of v2. */
  method: string;
  /** Its arguments, as the JSON the guest will receive. */
  argsJson: unknown;
  /** Monotonic per author device. A number spent on a refused warrant is gone. */
  nonce: number | bigint;
  /** Unix seconds after which the relay must refuse it. */
  notAfter: number | bigint;
  accountHeads?: string[];
  governanceFloor?: string[];
  /**
   * The author device's signing key, and the point of this module: a
   * non-extractable `CryptoKey` this page can use but never read.
   */
  signingKey: CryptoKey;
  /** Its public half, hex — captured at generation, since a non-extractable
   *  key cannot be exported to re-derive it. */
  devicePublicKey: string;
}

/**
 * Sign a warrant and return it hex-encoded, ready for `/intents`.
 *
 * Returns the encoding rather than an object for the reason mero-js does: the
 * signature covers exactly these bytes, and a caller that rebuilt the fields
 * from JSON would have a second spelling able to disagree with what was signed.
 */
export async function signWarrant(input: WarrantInput): Promise<string> {
  const context = fromHex(input.context, 'context', 32);
  const authorAccount = fromHex(input.authorAccount, 'authorAccount', 32);
  const executor = fromHex(input.executor, 'executor', 32);
  const appVersion = fromHex(input.appVersion ?? UNPINNED_APP, 'appVersion', 32);
  const publicKey = fromHex(input.devicePublicKey, 'devicePublicKey', 32);
  const accountHeads = citedHeads(input.accountHeads, 'accountHeads');
  const governanceFloor = citedHeads(input.governanceFloor, 'governanceFloor');

  const method = utf8(input.method);
  const commitment = await intentHash(input.method, input.argsJson);
  const nonce = u64le(input.nonce);
  const notAfter = u64le(input.notAfter);

  // Counts are u64 HERE and u32 in the encoding below. Not a typo.
  const preimage = await domainHash(SIGN_DOMAIN, [
    context,
    authorAccount,
    publicKey,
    executor,
    appVersion,
    method,
    commitment,
    u64le(accountHeads.length),
    ...accountHeads,
    u64le(governanceFloor.length),
    ...governanceFloor,
    nonce,
    notAfter,
  ]);

  const signature = await signEd25519(input.signingKey, preimage);

  return hex(
    concat(
      context,
      authorAccount,
      publicKey,
      executor,
      appVersion,
      u32le(method.length),
      method,
      commitment,
      u32le(accountHeads.length),
      ...accountHeads,
      u32le(governanceFloor.length),
      ...governanceFloor,
      nonce,
      notAfter,
      signature,
    ),
  );
}
