/**
 * Turn a device key into something the HTTP client can call per request.
 *
 * A session is a bearer token: mint once, present many times. A request-carried
 * proof is the opposite — it commits to one method, one path and one body, so
 * it has to be produced at the moment of the call, by something holding the
 * signing key. This is that something, shaped like `getAuthToken` so the key
 * stays with the caller and never reaches the transport.
 */
/** What the transport knows about the call it is about to make. */
export interface ProofRequest {
    /** `GET`, `POST`, … exactly as it will be sent. */
    method: string;
    /** The path and query the node will see, as `signedPath` reads them. */
    path: string;
    /** The exact bytes that will be sent, if any. */
    body?: unknown;
}
export interface ProofSignerOptions {
    /** `signDeviceCert(...)`, hex. */
    credential: string;
    /**
     * `signLoginStatement(...)`, hex — the three-link chain.
     *
     * Omit for the two-link chain, where `signerSecret` is the device key itself.
     */
    session?: string;
    /**
     * The ed25519 secret that signs each request, hex: the session key when
     * `session` is set, otherwise the device key.
     */
    signerSecret: string;
    /**
     * How long each signature stays valid. Seconds, default 120.
     *
     * This is what bounds replay and nothing else does, so it is deliberately
     * short and deliberately not configurable to "never". A clock skew allowance
     * lives on the node; this only has to outlive the flight time.
     */
    ttlSeconds?: number;
    /** Unix seconds. Injectable so a test does not depend on the wall clock. */
    now?: () => number;
}
/**
 * Build the `X-Calimero-Proof` value for one request.
 *
 * Pass the result to the HTTP client's `getProof`.
 */
export declare function createProofSigner(options: ProofSignerOptions): (request: ProofRequest) => Promise<string>;
