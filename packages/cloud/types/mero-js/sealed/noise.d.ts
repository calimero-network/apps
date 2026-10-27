/**
 * The Noise NK handshake (`Noise_NK_25519_AESGCM_SHA256`) that opens a sealed
 * session, written against WebCrypto from the Noise specification
 * (revision 34, http://www.noiseprotocol.org/noise.html). The node runs the
 * other side with `snow`; core's published vectors check the two against each
 * other.
 *
 * NK: the initiator knows the responder's static key in advance — here the
 * transport key the node's quote commits to — and sends nothing but an
 * ephemeral key before both ephemerals are mixed in, so everything after the
 * handshake has forward secrecy.
 */
/** Noise's `SymmetricState`: the chaining key, the handshake hash and the cipher key. */
export declare class SymmetricState {
    private ck;
    private h;
    private k;
    private n;
    private constructor();
    static initialize(): Promise<SymmetricState>;
    mixHash(data: Uint8Array): Promise<void>;
    mixKey(inputKeyMaterial: Uint8Array): Promise<void>;
    encryptAndHash(plaintext: Uint8Array): Promise<Uint8Array>;
    decryptAndHash(ciphertext: Uint8Array): Promise<Uint8Array>;
    /** The initiator-to-responder key, then the responder-to-initiator key. */
    split(): Promise<[Uint8Array, Uint8Array]>;
}
export interface X25519KeyPair {
    privateKey: CryptoKey;
    publicKey: Uint8Array;
}
/**
 * Start an NK handshake to `remoteStatic`. `fixedEphemeral` pins the
 * ephemeral secret, for the published test vectors only; leave it out.
 */
export declare function initiate(remoteStatic: Uint8Array, prologue: Uint8Array, fixedEphemeral?: Uint8Array): Promise<{
    message1: Uint8Array;
    finish(message2: Uint8Array): Promise<{
        payload: Uint8Array;
        split: [Uint8Array, Uint8Array];
    }>;
}>;
export declare function x25519KeyPair(secret?: Uint8Array): Promise<X25519KeyPair>;
export declare function dh(privateKey: CryptoKey, publicKey: Uint8Array): Promise<Uint8Array>;
