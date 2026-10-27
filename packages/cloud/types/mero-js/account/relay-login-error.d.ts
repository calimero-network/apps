import { RequestAuthError } from '../http-client/web-client.js';
/**
 * Why a relay login failed, as far as it decides what the app does next.
 *
 * - `signed-out` — the relay answered and refused the credential (401 or 403):
 *   it expired or was revoked, and signing in again is the way forward.
 * - `unavailable` — the login never got an answer about the credential: the
 *   relay could not be reached (DNS, TLS, offline, a timeout), or it failed
 *   with a 5xx, or answered something else. Trying again later may work.
 */
export type RelayLoginFailureKind = 'signed-out' | 'unavailable';
/**
 * The relay session a request needed could not be minted.
 *
 * Thrown by the admin requests of a delegated client (`client.admin.*`) in
 * place of sending them without a token, so the caller sees the login's own
 * failure rather than the node's 401 for the unauthenticated request — or, for
 * a relay that is down, the same transport error a second time. Nothing is
 * remembered: the next request logs in again.
 */
export declare class RelayLoginError extends RequestAuthError {
    name: string;
    readonly relayUrl: string;
    /** The login's own failure: an `HTTPError` (status 0 for no response) or what it threw. */
    readonly cause: unknown;
    readonly kind: RelayLoginFailureKind;
    /** The HTTP status the login answered, 0 when no response arrived; undefined when not an HTTP failure. */
    readonly loginStatus: number | undefined;
    constructor(relayUrl: string, cause: unknown);
}
/** `signed-out` for a login answered 401/403, `unavailable` for anything else. */
export declare function relayLoginFailureKind(cause: unknown): RelayLoginFailureKind;
