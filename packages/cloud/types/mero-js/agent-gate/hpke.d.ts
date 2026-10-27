/**
 * RFC 9180 HPKE, the one suite and mode mero-agent-gate takes: Auth mode,
 * DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20-Poly1305, single-shot
 * (one message per context, sequence number 0). Auth mode proves the sender:
 * the gate opens a bundle only under the X25519 key it names, so nobody can
 * seal in an owner's name.
 *
 * X25519 and HMAC are WebCrypto; ChaCha20-Poly1305 is ./chacha20poly1305.
 * The tests open what mero-agent-gate (Rust, the `hpke` crate) sealed, and the
 * gate opens what this seals.
 */
export interface HpkeSealed {
    /** The encapsulated key: the sender's ephemeral X25519 public key. */
    enc: Uint8Array;
    ciphertext: Uint8Array;
}
/**
 * Seal `plaintext` to `recipientPublic` in Auth mode as the holder of
 * `senderSecret` (32 raw X25519 bytes). `ephemeralSecret` is for tests.
 */
export declare function hpkeSealAuth(recipientPublic: Uint8Array, senderSecret: Uint8Array, info: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array, ephemeralSecret?: Uint8Array): Promise<HpkeSealed>;
/** Open what {@link hpkeSealAuth} (or the gate's own sealer) made, as the recipient. */
export declare function hpkeOpenAuth(recipientSecret: Uint8Array, senderPublic: Uint8Array, info: Uint8Array, sealed: HpkeSealed, aad?: Uint8Array): Promise<Uint8Array>;
