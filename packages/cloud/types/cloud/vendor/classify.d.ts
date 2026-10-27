/**
 * The HTTP status an error carries, in any shape a client throws: mero-js's
 * `HTTPError.status`, an axios-style `response.status`, or a bare `statusCode`.
 * Undefined when there is none — a thrown string, or an error raised before the
 * request was sent.
 */
export function statusOf(err: any): number;
/**
 * The most specific human-readable explanation an error carries, or
 * `fallback`. Prefers the node's words (`HTTPError.explanation`, or an axios
 * body's `error`/`message`) over a message that repeats the status line.
 */
export function messageOf(err: any, fallback?: string): string;
/**
 * What a failed request means: its kind, whether a later attempt could work,
 * and the node's own words for it.
 *
 * Accepts anything a `catch` hands over. A browser `fetch` that could not
 * connect throws a `TypeError`, which is read as `unreachable` like mero-js's
 * own status-0 `HTTPError`.
 */
export function classifyError(err: any): {
    kind: string;
    status: number;
    retryable: any;
    message: string;
};
