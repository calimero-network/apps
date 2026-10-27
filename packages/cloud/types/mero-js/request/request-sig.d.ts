/**
 * Sign one HTTP request, so a caller's identity travels with it.
 *
 * This is the bottom link of the chain a delegated client presents. A session
 * has the node mint and remember something; this has the caller prove itself on
 * every call, so the node holds no session state and the same path works
 * whether or not the node runs a login provider at all.
 *
 * ```text
 * account root ──signs──▶ DeviceCert       cold, once, offline
 * device key   ──signs──▶ LoginStatement   once per session, hours
 * session key  ──signs──▶ RequestSig       per call   ◀── this module
 * ```
 *
 * **The middle link is optional.** A CLI or a server-side job signs with its
 * device key directly and presents two links; a browser keeping the device key
 * behind a hardware or extension boundary mints a session key and presents
 * three. The node's verifier handles both, so which you produce here is a
 * question about where your key lives, not about what the node accepts.
 *
 * **What it binds.** Method, path and query, and a hash of the body. A
 * signature for `GET /a?x=1` is not a signature for `POST /a?x=1`, for
 * `GET /a?x=2`, for `GET /b?x=1`, or for the same call with a different body.
 *
 * **The path includes the query string**, exactly as it goes on the request
 * line: no re-encoding, no reordering. A proxy between you and the node must
 * forward both unchanged, or the node refuses the proof.
 *
 * **The method is not normalized.** `HEAD` and `GET` are the same *permission*
 * and the node's permission layer folds them, but they are different requests.
 * Sign the method you are about to send.
 *
 * **Replay inside the window performs the identical request** and is bounded
 * rather than prevented — keep `expiresAt` short. A warrant, which authorizes a
 * change with lasting effect, carries a nonce ledger for this; a request
 * signature does not.
 *
 * **The byte contract is pinned in core**, at
 * `crates/account/src/tests/request_wire_fixture.rs`, for the same reason the
 * warrant and login ones are: the domains are `pub(crate)` there and the field
 * order is implicit in a `derive`, so nothing on that side forces anyone to
 * notice this file depends on both. This module's test asserts the same vectors.
 */
import { fromHex } from "../crypto/internal.js";
export declare const SIGN_DOMAIN: Uint8Array;
/**
 * Commit to a request body.
 *
 * Always call it, including for a body-less request: an empty body hashes to a
 * value like any other, and there is no "absent body" encoding for a verifier
 * to disagree with you about.
 */
export declare function requestBodyHash(body?: Uint8Array | string): Promise<Uint8Array>;
/** What a caller is about to send. */
export interface RequestSigInput {
    /**
     * The HTTP method, exactly as it will appear on the wire — `GET`, `POST`,
     * `HEAD`. Not folded: see the module note.
     */
    method: string;
    /**
     * The path and query, exactly as on the request line:
     * `/admin-api/blobs?context_id=…`. Use `signedPath` to take it from a URL.
     */
    path: string;
    /**
     * The request body, or nothing. Pass exactly the bytes you will send: the
     * signature commits to their hash, so a body re-serialized between signing
     * and sending is a signature for a different request.
     */
    body?: Uint8Array | string;
    /** Unix seconds at signing. */
    issuedAt: number | bigint;
    /**
     * Unix seconds after which the node must refuse it.
     *
     * Keep it short — minutes, not hours. It is what bounds replay, and nothing
     * else does.
     */
    expiresAt: number | bigint;
    /**
     * The ed25519 signing secret, hex (32 bytes): the session key on the
     * three-link chain, the device key on the two-link one.
     *
     * Never sent anywhere. It signs locally and only the signature travels.
     */
    signerSecret: string;
}
/**
 * Sign one request and return it hex-encoded, ready to present.
 *
 * Returns the encoding rather than an object for the reason `signWarrant` and
 * `signLoginStatement` do: the signature covers exactly these bytes, and a
 * caller that rebuilt the fields from JSON would have a second spelling able to
 * disagree with what was signed.
 */
export declare function signRequest(input: RequestSigInput): Promise<string>;
/** Re-exported so a caller can check a hex signer key before signing with it. */
export { fromHex };
