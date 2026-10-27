import type { Signer } from '../signer/index.js';
/** What a keyholder holds: a certificate, and the key it certifies. */
export interface ProofCredential {
    /** The `AccountProof<DeviceCert>` from `signDeviceCert`, hex. */
    credential: string;
    /** The certified device's ed25519 secret, hex. Or pass `signer`. */
    deviceSecret?: string;
    /** A signer, for a key that cannot be exported to hex. */
    signer?: Signer;
    /** Seconds each signature stays valid. Defaults to `signRequestProof`'s. */
    validForSeconds?: number;
}
/** One request, as the proof has to see it. */
export interface RequestToAuthorize {
    method: string;
    /** Path and query, as `signedPath` reads them from the URL being fetched. */
    path: string;
    /** The body exactly as it will be sent, if there is one. */
    body?: string | Uint8Array;
}
/**
 * A per-request authorizer. Returns the headers to merge into the request.
 *
 * Returning headers rather than setting them keeps the caller in charge of the
 * request: a transport that already has an `Authorization` header can decide
 * which wins, and core decides the same way — a request carrying a token is
 * answered by that token, and the proof is only consulted when there is none.
 */
export type RequestAuthorizer = (request: RequestToAuthorize) => Promise<Record<string, string>>;
/**
 * Turn a device cert into a {@link RequestAuthorizer}.
 *
 * The credential is validated once, here, rather than on the first request:
 * a malformed one otherwise surfaces as a 401 from whichever read happened to
 * run first, which reads as "the node refused me" and sends the caller looking
 * in the wrong place.
 */
export declare function createProofAuthorizer(credential: ProofCredential): RequestAuthorizer;
/** The path and query a proof signs, read from the parsed URL: the serialization
 * `fetch` puts on the request line, base-URL prefix and escapes included. */
export declare function signedPath(url: string): string;
