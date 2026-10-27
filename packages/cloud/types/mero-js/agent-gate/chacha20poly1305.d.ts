/**
 * ChaCha20-Poly1305 (RFC 8439), the AEAD mero-agent-gate's HPKE suite uses.
 * WebCrypto has no ChaCha20, and the SDK takes no runtime dependencies, so it
 * is written here from the RFC. Its tests check it against the RFC's vectors
 * and against Node's own implementation.
 *
 * Only for sealing a provisioning bundle once: short messages, one key per
 * message. Not constant-time in Poly1305's arithmetic (BigInt), which leaks
 * nothing here: the one-time Poly1305 key is never reused.
 */
/** One 64-byte ChaCha20 block (RFC 8439 §2.3). */
export declare function chacha20Block(key: Uint8Array, counter: number, nonce: Uint8Array): Uint8Array;
/** ChaCha20 encryption from block `counter` on (RFC 8439 §2.4). */
export declare function chacha20(key: Uint8Array, counter: number, nonce: Uint8Array, data: Uint8Array): Uint8Array;
/** Poly1305 over `message` with the one-time `key` (RFC 8439 §2.5). */
export declare function poly1305(key: Uint8Array, message: Uint8Array): Uint8Array;
/** Seal: the ciphertext followed by its 16-byte tag (RFC 8439 §2.8). */
export declare function chacha20Poly1305Seal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array;
/** Open what {@link chacha20Poly1305Seal} made; throws if it was altered. */
export declare function chacha20Poly1305Open(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, aad?: Uint8Array): Uint8Array;
