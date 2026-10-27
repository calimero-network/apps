import type { Signer } from '../signer/index.js';
/** The header a signed request carries. */
export declare const REQUEST_PROOF_HEADER = "X-Calimero-Proof";
export interface RequestProofInput {
    /**
     * The HTTP method, exactly as it will be sent.
     *
     * Not folded. `HEAD` and `GET` are the same *permission* and the node's
     * permission table treats them so, but they are different *requests*: folding
     * them here would let a proof minted for one be presented as the other.
     */
    method: string;
    /**
     * The path and query, exactly as on the request line, with no re-encoding or
     * reordering. Use `signedPath` to take it from a URL.
     */
    path: string;
    /**
     * The body, exactly as it will be sent. Omit when there is none.
     *
     * There is no "absent body" case: an omitted body commits to the hash of no
     * bytes, so a signer and a verifier cannot disagree about which encoding a
     * bodyless request used.
     */
    body?: string | Uint8Array;
    /** The `AccountProof<DeviceCert>` from `signDeviceCert`, hex. */
    credential: string;
    /** The certified device's ed25519 secret, hex. Or pass `signer`. */
    deviceSecret?: string;
    /** A signer, for a key that cannot be exported to hex. */
    signer?: Signer;
    /** Seconds the signature stays valid. Defaults to 300. */
    validForSeconds?: number;
    /** Override the clock, for tests. Unix seconds. */
    now?: number;
}
/**
 * Sign one request and return the `X-Calimero-Proof` value, hex.
 *
 * The encoding is borsh, and it is assembled rather than re-derived: the
 * account proof is the **first** field of `CallerProof`, so the credential hex
 * a caller already holds is exactly its own prefix. Concatenating avoids a
 * second implementation of a structure the node deserializes — the class of bug
 * that surfaces far away, as a node refusing a credential nothing can explain.
 *
 *   CallerProof = <account_proof bytes> || 0x00 (no session) || RequestSig
 *   RequestSig  = u32le(len method) || method
 *               || u32le(len path)  || path (with its query)
 *               || body_hash[32]
 *               || u64le(issued_at) || u64le(expires_at)
 *               || signature[64]
 */
export declare function signRequestProof(input: RequestProofInput): Promise<string>;
