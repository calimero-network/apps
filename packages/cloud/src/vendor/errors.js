// Vendored from @calimero-network/mero-js 26.9.1 (MIT): pure helpers apps already
// rely on, unchanged except for import paths. The transport they once sat on is
// gone; see ../backend.ts for the release-v2 implementation.

const TERMINAL_AUTH_ERRORS = new Set(['token_reuse', 'token_revoked']);
/**
 * Pull the node's explanation out of an error body. Core answers every handled
 * failure with `{"error": "<message>"}` (`ApiError::into_response`); the nested
 * `{"error": {"message": ...}}` form is what proxies in front of a node emit.
 * Returns undefined for a non-JSON, empty, or envelope-less body.
 */
function extractErrorMessage(bodyText) {
    if (!bodyText)
        return undefined;
    try {
        const body = JSON.parse(bodyText);
        const error = body?.error;
        if (typeof error === 'string' && error.trim() !== '')
            return error;
        const nested = error?.message;
        if (typeof nested === 'string' && nested.trim() !== '')
            return nested;
        // FastAPI's spelling, which is what every Calimero Cloud route answers
        // with. Without it a manager's carefully worded refusal — "ownership is
        // recorded, but the account is not linked" — reached callers as a bare
        // "HTTP 403", and the one thing they could do about it was invisible.
        const detail = body?.detail;
        if (typeof detail === 'string' && detail.trim() !== '')
            return detail;
    }
    catch {
        // Not JSON — the status line is all we can honestly report.
    }
    return undefined;
}
export class HTTPError extends Error {
    constructor(status, statusText, url, headers, bodyText) {
        // Status 0 means no response arrived: every client puts the thrown error's
        // message in `bodyText`, as plain text. It is the only explanation there is
        // — "The node refused to attest: HTTP 404" from a sealed fetch, or
        // "This operation was aborted" from a timeout — so report it as is.
        const explanation = extractErrorMessage(bodyText) ??
            (status === 0 && bodyText?.trim() ? bodyText.trim() : undefined);
        super(explanation
            ? `HTTP ${status} ${statusText}: ${explanation}`
            : `HTTP ${status} ${statusText}`);
        this.status = status;
        this.statusText = statusText;
        this.url = url;
        this.headers = headers;
        this.bodyText = bodyText;
        this.name = 'HTTPError';
        this.explanation = explanation;
    }
    toJSON() {
        return {
            status: this.status,
            statusText: this.statusText,
            url: this.url,
            headers: headersToRecord(this.headers),
            bodyText: this.bodyText,
        };
    }
}
/**
 * Terminal authentication error: the refresh-token family was revoked (single-use
 * refresh token replayed, or the token was explicitly revoked). Never retried and
 * never refreshed — apps should catch this and force a re-login.
 *
 * Extends {@link HTTPError} so existing `instanceof HTTPError` handling keeps working.
 */
export class AuthRevokedError extends HTTPError {
    constructor(
    /** Value of the `x-auth-error` header, e.g. `token_reuse` or `token_revoked`. */
    reason, status, statusText, url, headers, bodyText) {
        super(status, statusText, url, headers, bodyText);
        this.reason = reason;
        this.name = 'AuthRevokedError';
        this.message = `Authentication revoked (${reason}): HTTP ${status} ${statusText}`;
    }
}
/**
 * A failure of a transport's `getAuthToken` that must stop the request.
 *
 * Any other error from `getAuthToken` is ignored and the request goes out
 * without a token, which is right for a credential that is merely absent. This
 * one says the credential could not be obtained at all — the login it needed
 * was refused, or never reached the server — so sending the request anyway
 * would only trade the real cause for the server's 401, or for the same
 * transport error a second time. Thrown as is from the request.
 */
export class RequestAuthError extends Error {
    constructor() {
        super(...arguments);
        this.name = 'RequestAuthError';
    }
}
function headersToRecord(headers) {
    const record = {};
    headers.forEach((value, key) => {
        record[key] = value;
    });
    return record;
}
/**
 * The relay session a request needed could not be minted.
 *
 * Thrown by the admin requests of a delegated client (`client.admin.*`) in
 * place of sending them without a token, so the caller sees the login's own
 * failure rather than the node's 401 for the unauthenticated request — or, for
 * a relay that is down, the same transport error a second time. Nothing is
 * remembered: the next request logs in again.
 */
export class RelayLoginError extends RequestAuthError {
    constructor(relayUrl, cause) {
        const kind = relayLoginFailureKind(cause);
        const detail = cause instanceof Error ? cause.message : String(cause);
        super(kind === 'signed-out'
            ? `the relay ${relayUrl} refused this device's credential (${detail}); sign in again`
            : `could not log in to the relay ${relayUrl}: ${detail}`);
        this.name = 'RelayLoginError';
        this.cause = cause;
        this.relayUrl = relayUrl;
        this.kind = kind;
        this.loginStatus = loginStatusOf(cause);
    }
}
/** `signed-out` for a login answered 401/403, `unavailable` for anything else. */
export function relayLoginFailureKind(cause) {
    const status = loginStatusOf(cause);
    return status === 401 || status === 403 ? 'signed-out' : 'unavailable';
}
/** The status a login failure carries (`HTTPError.status`), if any. */
function loginStatusOf(cause) {
    const status = cause?.status;
    return typeof status === 'number' && Number.isFinite(status) ? status : undefined;
}
