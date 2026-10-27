import { Transport, HttpClient } from './http-types.js';
export declare function createHttpClient(transport: Transport): HttpClient;
export declare function createBrowserHttpClient(options: {
    baseUrl: string;
    fetch?: typeof fetch;
    getAuthToken?: () => Promise<string | undefined>;
    getProof?: Transport['getProof'];
    onTokenRefresh?: (newToken: string) => Promise<void>;
    /**
     * Callback to refresh the access token when a 401 error with 'token_expired' is detected.
     * Should return the new access token, or throw an error if refresh fails.
     * If provided, the client will automatically retry the request after a successful refresh.
     */
    refreshToken?: () => Promise<string>;
    /**
     * Callback invoked when the server reports a revoked token family
     * (`x-auth-error: token_reuse` / `token_revoked`). Terminal — the request is
     * never retried; clear stored tokens and force a re-login.
     */
    onAuthRevoked?: () => Promise<void> | void;
    defaultHeaders?: Record<string, string>;
    timeoutMs?: number;
    credentials?: RequestCredentials;
    defaultAbortSignal?: AbortSignal;
}): HttpClient;
export declare function createNodeHttpClient(options: {
    baseUrl: string;
    fetch?: typeof fetch;
    getAuthToken?: () => Promise<string | undefined>;
    getProof?: Transport['getProof'];
    onTokenRefresh?: (newToken: string) => Promise<void>;
    /**
     * Callback to refresh the access token when a 401 error with 'token_expired' is detected.
     * Should return the new access token, or throw an error if refresh fails.
     * If provided, the client will automatically retry the request after a successful refresh.
     */
    refreshToken?: () => Promise<string>;
    /**
     * Callback invoked when the server reports a revoked token family
     * (`x-auth-error: token_reuse` / `token_revoked`). Terminal — the request is
     * never retried; clear stored tokens and force a re-login.
     */
    onAuthRevoked?: () => Promise<void> | void;
    defaultHeaders?: Record<string, string>;
    timeoutMs?: number;
    credentials?: RequestCredentials;
    defaultAbortSignal?: AbortSignal;
}): HttpClient;
export declare function createUniversalHttpClient(options: {
    baseUrl: string;
    fetch?: typeof fetch;
    getAuthToken?: () => Promise<string | undefined>;
    getProof?: Transport['getProof'];
    onTokenRefresh?: (newToken: string) => Promise<void>;
    /**
     * Callback to refresh the access token when a 401 error with 'token_expired' is detected.
     * Should return the new access token, or throw an error if refresh fails.
     * If provided, the client will automatically retry the request after a successful refresh.
     */
    refreshToken?: () => Promise<string>;
    /**
     * Callback invoked when the server reports a revoked token family
     * (`x-auth-error: token_reuse` / `token_revoked`). Terminal — the request is
     * never retried; clear stored tokens and force a re-login.
     */
    onAuthRevoked?: () => Promise<void> | void;
    defaultHeaders?: Record<string, string>;
    timeoutMs?: number;
    credentials?: RequestCredentials;
    defaultAbortSignal?: AbortSignal;
}): HttpClient;
