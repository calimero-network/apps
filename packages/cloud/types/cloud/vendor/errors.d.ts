/** `signed-out` for a login answered 401/403, `unavailable` for anything else. */
export function relayLoginFailureKind(cause: any): "signed-out" | "unavailable";
export class HTTPError extends Error {
    constructor(status: any, statusText: any, url: any, headers: any, bodyText: any);
    status: any;
    statusText: any;
    url: any;
    headers: any;
    bodyText: any;
    explanation: any;
    toJSON(): {
        status: any;
        statusText: any;
        url: any;
        headers: {};
        bodyText: any;
    };
}
/**
 * Terminal authentication error: the refresh-token family was revoked (single-use
 * refresh token replayed, or the token was explicitly revoked). Never retried and
 * never refreshed — apps should catch this and force a re-login.
 *
 * Extends {@link HTTPError} so existing `instanceof HTTPError` handling keeps working.
 */
export class AuthRevokedError extends HTTPError {
    constructor(reason: any, status: any, statusText: any, url: any, headers: any, bodyText: any);
    reason: any;
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
    constructor(...args: any[]);
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
    constructor(relayUrl: any, cause: any);
    cause: any;
    relayUrl: any;
    kind: string;
    loginStatus: number;
}
