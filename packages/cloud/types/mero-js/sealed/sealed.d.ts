/**
 * Sealed transport: requests encrypted end to end to a TEE node's attested key.
 *
 * A node speaks plain HTTP and any TLS in front of it ends outside the enclave,
 * at whatever proxy or relay the operator runs, so everything crossing that hop
 * (the bearer token, JSON-RPC arguments, results) is readable there. Sealing
 * encrypts it so that only the attested TD can read it, and only the TD can
 * produce a response the client accepts.
 *
 * The client opens a session with a Noise NK handshake to the X25519 transport
 * key the node's quote commits to ({@link fetchAttestedTransportKey}). The
 * transport key only authenticates the node: the session keys come from both
 * sides' ephemeral keys, so once a session is gone (an hour at most) what was
 * sent in it cannot be opened, not even with the transport key. Each request
 * is sealed under the session; each response streams back in sealed frames, so
 * server-sent events are sealed too. WebSockets cannot be, and the node
 * refuses one inside the envelope with a 501.
 *
 * The node's side, and the wire format this implements byte for byte, are in
 * core's `crates/server/src/sealed.rs`:
 *
 * ```text
 * handshake   Noise_NK_25519_AESGCM_SHA256, prologue "calimero/sealed-http/v2"
 *   request   POST /sealed/v2/handshake   0x02 || transport_pk || Noise message 1
 *   response  0x02 || Noise message 2 (payload = session_id(16) || lifetime secs, u32 BE)
 *   keys      (req key, resp key) = Split()
 * exchange    POST /sealed/v2
 *   header    0x02 || session_id(16) || request_id (u64 BE; from 1, each used once)
 *   request   header || AES-256-GCM(req key, nonce = request_id || 0u32, aad = header, inner)
 *   response  frames, each u32 BE length || AES-256-GCM(resp key,
 *             nonce = request_id || frame index (u32 BE, from 0), aad = header, kind || data)
 *             kind 0 = head (JSON), 1 = body bytes, 2 = end; no end frame = cut short
 *   inner     u32 BE head length || head (JSON) || body
 * ```
 *
 * Use it by handing {@link createSealedFetch} to `MeroJsConfig.fetch`.
 */
import type { TeeAttestRequest, TeeAttestResponseData } from '../admin-api/admin-types.js';
import { initiate } from './noise.js';
import type { DcapCollateral } from './verify.js';
/** Where a session is opened, relative to the node's base URL. */
export declare const HANDSHAKE_PATH = "/sealed/v2/handshake";
/** Where sealed requests are posted, relative to the node's base URL. */
export declare const SEALED_PATH = "/sealed/v2";
/** Content type of every sealed body. */
export declare const SEALED_CONTENT_TYPE = "application/vnd.calimero.sealed";
/** The node no longer holds the transport key this client attested (it restarted). */
export declare class StaleTransportKeyError extends Error {
    name: string;
    constructor();
}
/** The node refused the envelope itself, before anything inside it ran. */
export declare class SealedTransportError extends Error {
    status: number;
    code: string | undefined;
    /** How long the node asked to wait before retrying (`Retry-After`), if it did. */
    retryAfterMs?: number;
    name: string;
    constructor(status: number, code: string | undefined, message: string, 
    /** How long the node asked to wait before retrying (`Retry-After`), if it did. */
    retryAfterMs?: number);
}
/**
 * What the attest endpoint puts in report data bytes `32..64` when asked to
 * bind its transport key. `inner` is what would have been there otherwise: the
 * expected application hash, or 32 zero bytes when none was asked for.
 * Mirrors core's `attest_transport_binding`.
 */
export declare function transportKeyBinding(inner: Uint8Array, transportKey: Uint8Array): Promise<Uint8Array>;
export interface VerifyTransportQuote {
    /**
     * Verify `quoteB64` — never by asking the node being attested — and check
     * that its report data is `nonce || reportDataSuffix` (both hex). Resolve
     * true only when the quote is genuine, its measurements are ones you accept,
     * and the report data matches. {@link createQuoteVerifier} does all of this
     * in the page. `collateral` is what the node sent with the quote, when the
     * verifier asked for it.
     */
    (args: {
        quoteB64: string;
        nonce: string;
        reportDataSuffix: string;
        collateral?: DcapCollateral;
    }): Promise<boolean>;
    /**
     * Ask the node for the collateral its quote verifies against, and pass it
     * in as `collateral`. Off unless set, because a node that predates the field
     * refuses the request.
     */
    readonly includeCollateral?: boolean;
}
/**
 * Ask a node for its transport key and accept it only if a quote you verified
 * commits to it.
 *
 * `applicationHash` (hex), when given, is the bytecode hash you expect the
 * attested application to have; the node is asked to bind that application,
 * and the quote only verifies if it runs that exact bytecode.
 */
export declare function fetchAttestedTransportKey(admin: {
    teeAttest(request: TeeAttestRequest): Promise<TeeAttestResponseData>;
}, verify: VerifyTransportQuote, options?: {
    applicationId?: string;
    applicationHash?: string;
}): Promise<Uint8Array>;
export interface AttestedSealedFetchOptions {
    /** The node's base URL. */
    baseUrl: string;
    /**
     * Decides whether the node's quote is one you trust — typically
     * {@link createQuoteVerifier}. Asked again whenever the node restarts.
     */
    verify: VerifyTransportQuote;
    /** Also require the node to run this application with this bytecode hash. */
    applicationId?: string;
    applicationHash?: string;
    /** Fetch that carries the attestation and the envelopes. Defaults to global `fetch`. */
    fetch?: typeof fetch;
}
/**
 * {@link createSealedFetch} for a node you know only by URL: it attests the
 * node's transport key with `verify`, over `POST /admin-api/tee/attest` (the
 * one call that needs no credential and is never sealed), and seals everything
 * else to it. A restarted node is attested again, through the same verifier.
 *
 * This is what to hand a {@link RelayClient} for a TEE relay, so the warrant
 * and the method's arguments reach only the attested TD:
 *
 * ```ts
 * const relay = new RelayClient({
 *   relayUrl,
 *   fetch: createAttestedSealedFetch({ baseUrl: relayUrl, verify: createQuoteVerifier(...) }),
 *   ...
 * });
 * ```
 */
export declare function createAttestedSealedFetch(options: AttestedSealedFetchOptions): typeof fetch;
export interface SealedFetchOptions {
    /** The node's base URL, as given to `MeroJsConfig.baseUrl`. */
    baseUrl: string;
    /**
     * The node's attested transport key, or a function that attests and returns
     * it — typically `() => fetchAttestedTransportKey(admin, verify)`. Given a
     * function, a restarted node is handled: the key is attested again, through
     * your verifier, and the request retried once. Given bytes, a restart
     * surfaces as {@link StaleTransportKeyError}.
     */
    transportPublicKey: Uint8Array | (() => Promise<Uint8Array>);
    /** Fetch that carries the sealed envelope. Defaults to global `fetch`. */
    fetch?: typeof fetch;
}
/**
 * A `fetch` that seals every request to the node's attested transport key.
 * Pass it as `MeroJsConfig.fetch`.
 *
 * A request for any URL outside `baseUrl` is refused rather than sent in the
 * clear: falling back to plaintext would silently undo the point of sealing.
 */
export declare function createSealedFetch(options: SealedFetchOptions): typeof fetch;
export interface Session {
    requestKey: CryptoKey;
    responseKey: CryptoKey;
    nextRequestId: number;
    renewAt: number;
    header(requestId: number): Uint8Array;
}
/** Finish the handshake with the node's reply. Exported for the published vectors. */
export declare function sessionFrom(noise: Awaited<ReturnType<typeof initiate>>, reply: Uint8Array): Promise<Session>;
/** Seal one request under the session's next request id. */
export declare function sealRequest(session: Session, head: RequestHead, body: Uint8Array): Promise<{
    requestId: number;
    header: Uint8Array;
    envelope: Uint8Array;
}>;
export interface RequestHead {
    method: string;
    path: string;
    headers: Array<[string, string]>;
}
export interface ResponseHead {
    status: number;
    headers: Array<[string, string]>;
}
/**
 * Open a sealed response as it streams: wait for its head, then hand back a
 * `Response` whose body opens each frame as it arrives. A frame that does not
 * open, arrives out of order, or a stream that stops before its end frame
 * errors the body rather than passing anything unauthenticated on.
 */
export declare function openResponse(response: Response, responseKey: CryptoKey, header: Uint8Array, requestId: number): Promise<Response>;
