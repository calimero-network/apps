/**
 * Byte-level primitives shared by everything in this package that signs.
 *
 * Extracted from `warrant/warrant.ts` when the device-cert signer arrived and
 * needed the same `domainHash`, hex handling and ed25519 import. Keeping one
 * copy is the point: these have to stay byte-identical with core, and two
 * copies drifting apart is exactly the failure the byte-parity e2e exists to
 * catch. Internal — not exported from the package root.
 */
/** Little-endian u32, for borsh fixed-width fields and epoch counters. */
export declare function u32le(value: number): Uint8Array;
export declare function hex(bytes: Uint8Array): string;
export declare function fromHex(value: string, label: string, expectedBytes: number): Uint8Array;
/**
 * Decode hex of an unknown length.
 *
 * The sized {@link fromHex} is the right default — every key and digest here
 * has a fixed width, and checking it catches a truncated paste at the edge
 * rather than deep inside a signature check. This one exists for the already-
 * encoded structures whose length is genuinely variable: a device certificate,
 * a login statement, a request signature. It still rejects odd-length and
 * non-hex input, so the only check it gives up is the one that cannot apply.
 */
export declare function fromHexUnsized(value: string, label: string): Uint8Array;
export declare function u64le(value: number | bigint): Uint8Array;
export declare function concat(...parts: Uint8Array[]): Uint8Array;
/**
 * core's `domain_hash`: SHA-256 over the length-prefixed domain, then each
 * length-prefixed part. The lengths are what stop two different field splits from
 * hashing alike.
 */
export declare function domainHash(domain: Uint8Array, parts: Uint8Array[]): Promise<Uint8Array>;
export declare function importSigningKey(secretHex: string): Promise<CryptoKey>;
/**
 * Check an ed25519 signature against a public key, both raw.
 *
 * The one primitive here that consumes rather than produces a signature: a page
 * handed a credential by another origin has to check it before it acts on it,
 * and "the node will reject it later" is not the same safeguard — by then the
 * page has already stored an account it does not control.
 *
 * `raw` import is the public-key counterpart of the PKCS#8 import above and is
 * available on exactly the runtimes that can sign, so a runtime that got this
 * far will not fail here for lack of support.
 *
 * @param publicKey 64 hex, the key the signature must verify against
 */
export declare function verifySignature(publicKey: string, signature: Uint8Array, payload: Uint8Array): Promise<boolean>;
/**
 * The public half of an ed25519 seed.
 *
 * Derived rather than taken as an argument, for the reason core does the same: a
 * caller able to name a key it does not hold could produce a warrant it cannot
 * sign, and the field would stop meaning "who authorised this".
 */
export declare function derivePublicKey(secretHex: string): Promise<Uint8Array>;
