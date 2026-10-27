export type FetchLike = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
export interface Transport {
    fetch: FetchLike;
    baseUrl: string;
    defaultHeaders?: Record<string, string>;
    getAuthToken?: () => Promise<string | undefined>;
    /**
     * Per-request authorization, for a credential that commits to the request.
     *
     * `getAuthToken` returns one value reused across requests; a request proof
     * signs the method, the path and the body, so it can only be produced where
     * those are known. This is called with exactly that, and whatever it returns
     * is merged into the headers.
     *
     * It runs AFTER `getAuthToken`, so a transport holding both sends both and
     * lets the node decide — which it does by answering a request carrying a token
     * by that token, and consulting a proof only when there is none.
     */
    authorizeRequest?: (request: {
        method: string;
        /** The path and query the node will see, as `signedPath` reads them. */
        path: string;
        body?: string | Uint8Array;
    }) => Promise<Record<string, string>>;
    /**
     * Sign each request instead of, or alongside, presenting a session.
     *
     * Called per call with the method, the path the node will see, and the exact
     * body — a proof commits to all three, so unlike `getAuthToken` it cannot be
     * resolved once and reused. Returning `undefined` sends no proof header,
     * which is how a client that only sometimes has a key stays usable.
     *
     * `createProofSigner` builds one of these from a credential and a key.
     */
    getProof?: (request: {
        method: string;
        path: string;
        body?: unknown;
    }) => Promise<string | undefined>;
    onTokenRefresh?: (newToken: string) => Promise<void>;
    /**
     * Callback to refresh the access token when a 401 error with 'token_expired' is detected.
     * Should return the new access token, or throw an error if refresh fails.
     * If provided, the client will automatically retry the request after a successful refresh.
     */
    refreshToken?: () => Promise<string>;
    /**
     * Callback invoked when the server reports that the token family is gone
     * (`x-auth-error: token_reuse` on 401, or `token_revoked`). Refresh tokens are
     * single-use, so this is terminal: the stored tokens must be dropped and the
     * user re-authenticated. The client never retries such a request.
     */
    onAuthRevoked?: () => Promise<void> | void;
    timeoutMs?: number;
    credentials?: RequestCredentials;
    defaultAbortSignal?: AbortSignal;
}
export type ResponseParser = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'response';
export interface RequestOptions extends RequestInit {
    parse?: ResponseParser;
    timeoutMs?: number;
}
export interface HttpClient {
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
}
export interface Header {
    [key: string]: string;
}
export interface ProgressCallback {
    (progress: number): void;
}
export interface HeadResponse {
    headers: Record<string, string>;
    status: number;
}
export interface LegacyRequestOptions {
    responseType?: 'arraybuffer' | 'blob' | 'json';
}
