import { HttpClient, Transport, RequestOptions } from './http-types.js';
export declare class HTTPError extends Error {
    status: number;
    statusText: string;
    url: string;
    headers: Headers;
    bodyText?: string;
    name: string;
    /**
     * The node's own words for the failure, without the `HTTP <status>` prefix
     * `message` carries: the body's `error` (or `detail`) for a response, the
     * thrown error's text for status 0. Undefined when there was none.
     */
    readonly explanation: string | undefined;
    constructor(status: number, statusText: string, url: string, headers: Headers, bodyText?: string);
    toJSON(): {
        status: number;
        statusText: string;
        url: string;
        headers: Record<string, string>;
        bodyText?: string;
    };
}
/**
 * Terminal authentication error: the refresh-token family was revoked (single-use
 * refresh token replayed, or the token was explicitly revoked). Never retried and
 * never refreshed — apps should catch this and force a re-login.
 *
 * Extends {@link HTTPError} so existing `instanceof HTTPError` handling keeps working.
 */
export declare class AuthRevokedError extends HTTPError {
    /** Value of the `x-auth-error` header, e.g. `token_reuse` or `token_revoked`. */
    reason: string;
    name: string;
    constructor(
    /** Value of the `x-auth-error` header, e.g. `token_reuse` or `token_revoked`. */
    reason: string, status: number, statusText: string, url: string, headers: Headers, bodyText?: string);
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
export declare class RequestAuthError extends Error {
    name: string;
}
/** Whether `headers` carry a request proof, which must never follow a redirect. */
export declare function carriesProof(headers: Record<string, string>): boolean;
/**
 * Throws when a proof-carrying request was answered with a redirect, which
 * fetch reports as an opaque response with status 0 under redirect: 'manual'.
 */
export declare function refuseProofRedirect(response: Response, url: string): void;
export declare class WebHttpClient implements HttpClient {
    private transport;
    private refreshTokenPromise;
    private onTokenRefreshPromise;
    constructor(transport: Transport);
    get<T>(path: string, init?: RequestOptions): Promise<T>;
    post<T>(path: string, body?: unknown, init?: RequestOptions): Promise<T>;
    put<T>(path: string, body?: unknown, init?: RequestOptions): Promise<T>;
    delete<T>(path: string, init?: RequestOptions): Promise<T>;
    patch<T>(path: string, body?: unknown, init?: RequestOptions): Promise<T>;
    head(path: string, init?: RequestOptions): Promise<{
        headers: Record<string, string>;
        status: number;
    }>;
    request<T>(path: string, init?: RequestOptions): Promise<T>;
    private makeRequest;
    private buildUrl;
    private createAbortSignal;
    private buildHeaders;
    private parseResponse;
    private getBodyText;
}
