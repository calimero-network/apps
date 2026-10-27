/**
 * Assemble the credential a node reads from `X-Calimero-Proof`.
 *
 * A request-carried proof is three links, and the node needs all of them in one
 * header: the account root certified the device, the device (optionally)
 * certified a short-lived session key, and that key signed THIS request. Each
 * link is minted by its own function here — {@link signDeviceCert},
 * {@link signLoginStatement}, {@link signRequest} — and each already returns
 * the borsh encoding of the Rust type the node deserializes. Rust's
 * `CallerProof` is a plain struct of those three fields, and borsh writes a
 * struct as its fields back to back, so assembling the header is concatenation
 * rather than a fourth encoder.
 *
 * That is worth stating because it is load-bearing and it is not obvious: if it
 * were re-encoded here there would be a second spelling of a signed structure,
 * able to disagree with the one that was signed. `caller-proof.test.ts` pins the
 * concatenation against bytes produced by core itself.
 */
/** The three links, each already hex-encoded by the function that signed it. */
export interface CallerProofInput {
    /**
     * `signDeviceCert(...)` — the account root's certificate over the device key,
     * with the genesis that names the account.
     */
    credential: string;
    /**
     * `signLoginStatement(...)`, when signing with a session key.
     *
     * Omit it on the two-link chain, where the device key signs the request
     * itself. Omitting is not the same as passing an empty string: borsh writes
     * `Option` as a tag byte, so the two produce different bytes and only one of
     * them parses.
     */
    session?: string;
    /** `signRequest(...)` — the signature over this exact method, path and body. */
    request: string;
}
/**
 * Concatenate the three links into the header value.
 *
 * Returns hex, ready to present as `X-Calimero-Proof`.
 */
export declare function callerProof(input: CallerProofInput): string;
