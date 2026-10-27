/** The kind of failure, as far as it decides what the caller does next. */
export type ErrorKind = 
/** 400. The request is wrong; sending it again cannot help. */
'invalid'
/** 401. This client's session lapsed; signing in again can finish it. */
 | 'unauthorized'
/** 403. The node will not do this for this caller. */
 | 'forbidden'
/** 404. What the request names does not exist on this node (yet). */
 | 'not-found'
/** 409. The request contradicts the current state: expired, spent, removed. */
 | 'conflict'
/** 410. It existed and is gone for good. */
 | 'gone'
/** 413. The body is over the node's limit. */
 | 'too-large'
/** 429. The node asked the caller to slow down. */
 | 'rate-limited'
/** 503 or 504. The node cannot serve this yet — no peer online, say. */
 | 'unavailable'
/** Any other 5xx. The node failed; the request may well have been fine. */
 | 'server'
/** Status 0. The request never reached the node: offline, CORS, a timeout. */
 | 'unreachable'
/** Not an HTTP failure, or one with nothing more specific to go on. */
 | 'unknown';
export interface ClassifiedError {
    kind: ErrorKind;
    /** The HTTP status, when the error carries one. 0 means no response. */
    status: number | undefined;
    /**
     * Whether the same request could succeed later without anything changing on
     * the caller's side. False for a refusal the node chose — asking again gets
     * the same answer — and true for a failure about the moment.
     */
    retryable: boolean;
    /**
     * The node's own explanation, without an `HTTP <status>` prefix, falling back
     * to the error's message. For logs and for a UI that shows detail; a UI that
     * wants friendly copy should switch on `kind`.
     */
    message: string;
}
/**
 * The HTTP status an error carries, in any shape a client throws: mero-js's
 * `HTTPError.status`, an axios-style `response.status`, or a bare `statusCode`.
 * Undefined when there is none — a thrown string, or an error raised before the
 * request was sent.
 */
export declare function statusOf(err: unknown): number | undefined;
/**
 * The most specific human-readable explanation an error carries, or
 * `fallback`. Prefers the node's words (`HTTPError.explanation`, or an axios
 * body's `error`/`message`) over a message that repeats the status line.
 */
export declare function messageOf(err: unknown, fallback?: string): string;
/**
 * What a failed request means: its kind, whether a later attempt could work,
 * and the node's own words for it.
 *
 * Accepts anything a `catch` hands over. A browser `fetch` that could not
 * connect throws a `TypeError`, which is read as `unreachable` like mero-js's
 * own status-0 `HTTPError`.
 */
export declare function classifyError(err: unknown): ClassifiedError;
