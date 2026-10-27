// Vendored from @calimero-network/mero-js 26.9.1 (MIT): pure helpers apps already
// rely on, unchanged except for import paths. The transport they once sat on is
// gone; see ../backend.ts for the release-v2 implementation.

import { RelayLoginError } from './errors.js';
const RETRYABLE = {
    invalid: false,
    // The session, not the request: signing in again and repeating it works.
    unauthorized: true,
    forbidden: false,
    // Too broad to give up on — the resource may simply not have synced yet.
    'not-found': true,
    conflict: false,
    gone: false,
    'too-large': false,
    'rate-limited': true,
    unavailable: true,
    server: true,
    unreachable: true,
    unknown: true,
};
function kindForStatus(status) {
    switch (status) {
        case 0:
            return 'unreachable';
        case 400:
            return 'invalid';
        case 401:
            return 'unauthorized';
        case 403:
            return 'forbidden';
        case 404:
            return 'not-found';
        case 409:
            return 'conflict';
        case 410:
            return 'gone';
        case 413:
            return 'too-large';
        case 429:
            return 'rate-limited';
        case 503:
        case 504:
            return 'unavailable';
    }
    if (status >= 500 && status < 600)
        return 'server';
    if (status >= 400 && status < 500)
        return 'invalid';
    return 'unknown';
}
/**
 * The HTTP status an error carries, in any shape a client throws: mero-js's
 * `HTTPError.status`, an axios-style `response.status`, or a bare `statusCode`.
 * Undefined when there is none — a thrown string, or an error raised before the
 * request was sent.
 */
export function statusOf(err) {
    if (!err || typeof err !== 'object')
        return undefined;
    const shaped = err;
    for (const candidate of [shaped.status, shaped.response?.status, shaped.statusCode]) {
        if (typeof candidate === 'number' && Number.isFinite(candidate))
            return candidate;
    }
    return undefined;
}
/**
 * The most specific human-readable explanation an error carries, or
 * `fallback`. Prefers the node's words (`HTTPError.explanation`, or an axios
 * body's `error`/`message`) over a message that repeats the status line.
 */
export function messageOf(err, fallback = 'Request failed') {
    if (typeof err === 'string')
        return err.trim() || fallback;
    if (!err || typeof err !== 'object')
        return fallback;
    const shaped = err;
    for (const candidate of [
        shaped.explanation,
        shaped.response?.data?.error,
        shaped.response?.data?.message,
        shaped.data?.message,
        shaped.error,
        shaped.message,
    ]) {
        if (typeof candidate === 'string' && candidate.trim())
            return candidate;
    }
    return fallback;
}
/**
 * What a failed request means: its kind, whether a later attempt could work,
 * and the node's own words for it.
 *
 * Accepts anything a `catch` hands over. A browser `fetch` that could not
 * connect throws a `TypeError`, which is read as `unreachable` like mero-js's
 * own status-0 `HTTPError`.
 */
export function classifyError(err) {
    // A relay login that failed before the request was sent: its own status is
    // about the login, so it is read by what it means for the request — a
    // refused credential is this client's session, anything else the relay's.
    if (err instanceof RelayLoginError) {
        const status = err.loginStatus;
        const kind = err.kind === 'signed-out' ? 'unauthorized' : status ? kindForStatus(status) : 'unreachable';
        return { kind, status, retryable: RETRYABLE[kind], message: messageOf(err) };
    }
    const status = statusOf(err);
    let kind;
    if (status !== undefined) {
        kind = kindForStatus(status);
    }
    else if (err instanceof TypeError) {
        kind = 'unreachable';
    }
    else {
        kind = 'unknown';
    }
    return { kind, status, retryable: RETRYABLE[kind], message: messageOf(err) };
}
