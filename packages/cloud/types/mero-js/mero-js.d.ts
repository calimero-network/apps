import type { AuthApiClient } from './auth-api/index.js';
import type { AdminApiClient } from './admin-api/index.js';
import type { TokenStore } from './token-store/index.js';
import type { ProofRequest, ProofSignerOptions } from './request/index.js';
import type { AuthCallbackResult, AuthLoginOptions, ParseAuthCallbackOptions } from './auth/index.js';
import { RpcClient } from './rpc/index.js';
import { SseClient } from './events/sse.js';
import { WsClient } from './events/ws.js';
import { EphemeralClient } from './ephemeral/index.js';
import { CloudClient } from './cloud/cloud-client.js';
import type { CloudClientConfig } from './cloud/cloud-client.js';
export interface MeroJsConfig {
    /** Base URL for the Calimero node */
    baseUrl: string;
    /** Initial credentials for authentication */
    credentials?: {
        username: string;
        password: string;
    };
    /** Custom HTTP client timeout in milliseconds */
    timeoutMs?: number;
    /** Request credentials mode for fetch (omit, same-origin, include) */
    requestCredentials?: RequestCredentials;
    /** Custom fetch for every HTTP request (`auth`, `admin`, `rpc`, `events`). Defaults to global `fetch`. */
    fetch?: typeof fetch;
    /** Optional token store for persistence */
    tokenStore?: TokenStore;
    /**
     * Called when the node reports that the credential family is gone
     * (`x-auth-error: token_reuse` / `token_revoked`). Terminal: the tokens have
     * already been cleared by the time this runs and nothing is retried, so use it
     * to send the user back through login. Errors thrown here are swallowed —
     * never let a UI failure mask the auth error.
     */
    onAuthRevoked?: () => Promise<void> | void;
    /**
     * Calimero Cloud, reachable as `sdk.cloud`.
     *
     * A node connection and a cloud account are separate things a client can have
     * either of, both of, or neither — a desktop app with a local node and a
     * cloud subscription has both, and needs them from one object. So this is
     * configuration on the existing SDK rather than a second SDK: pass the
     * session token (or none, and sign in through `sdk.cloud`) and the node half
     * is unaffected.
     *
     * For a caller with *no* node at all, `connectCloud` is the entry point
     * instead — it returns a connection that can write without one.
     */
    cloud?: CloudClientConfig;
    /**
     * Sign every request with a device key, instead of or alongside a session.
     *
     * A session is a bearer token: obtained once, presented many times. A
     * request-carried proof commits to one method, one path and one body, so it
     * is minted per call and cannot be lifted onto another request. It is what
     * lets a client talk to a relay it has no account on — nothing was ever
     * issued to it.
     *
     * Pass the keys and let the SDK mint each proof:
     *
     * ```ts
     * new MeroJs({
     *   baseUrl,
     *   requestProof: { credential, session, signerSecret },
     * });
     * ```
     *
     * …or pass your own signer, when the key must not reach the SDK at all — a
     * hardware token, or a worker that holds it:
     *
     * ```ts
     * new MeroJs({ baseUrl, requestProof: (req) => myWorker.sign(req) });
     * ```
     *
     * The node only honours this when it runs with `--delegated-access`; a node
     * that does not answers `403`, which is distinct from the `401` a bad proof
     * gets.
     *
     * Applies to the request/response API. `events` (SSE) and `ws` are long-lived
     * connections rather than requests, so a per-request signature does not
     * describe them — they still use the session.
     */
    requestProof?: ProofSignerOptions | ((request: ProofRequest) => Promise<string | undefined>);
}
export interface TokenData {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    /** Origin and path prefix of the issuing node; a store entry for another node is ignored. */
    node_origin?: string;
}
/**
 * Main MeroJs SDK class that manages all API clients and authentication
 */
export declare class MeroJs {
    private config;
    private httpClient;
    private authClient;
    private adminClient;
    private tokenData;
    private refreshPromise;
    private tokenStore;
    private storeHoldsTokens;
    private tokenGeneration;
    private readonly onStorage;
    private readonly nodeKey;
    private rpcClient;
    private sseClient;
    private wsClient;
    private wsWarned;
    private ephemeralClient?;
    private cloudClient?;
    constructor(config: MeroJsConfig);
    /**
     * Get the Auth API client
     */
    get auth(): AuthApiClient;
    /**
     * Get the Admin API client
     */
    get admin(): AdminApiClient;
    /**
     * Get the RPC client (lazy initialized)
     */
    get rpc(): RpcClient;
    /**
     * Get the SSE event client (lazy initialized)
     */
    get events(): SseClient;
    /**
     * Get the ephemeral-presence client (lazy initialized).
     *
     * Shares this instance's SSE client, so `subscribe` reuses the one event
     * stream rather than opening a second connection.
     */
    get ephemeral(): EphemeralClient;
    /**
     * Calimero Cloud (lazy initialized).
     *
     * Available whether or not `cloud` was configured — an app that signs in
     * later gets an unauthenticated client it can call `signInWithGoogle` on,
     * which is one fewer construction path than making the getter conditional.
     * It is entirely independent of this instance's node credential: the cloud
     * knows nothing about the node's tokens and the node knows nothing about the
     * cloud session.
     */
    get cloud(): CloudClient;
    /**
     * Get the WebSocket event client (lazy initialized).
     * @experimental Use `events` (SSE) for production. WsClient is experimental.
     */
    get ws(): WsClient;
    /**
     * Authenticate with the provided credentials
     * This will create the root key on first use
     */
    authenticate(credentials?: {
        username: string;
        password: string;
    }): Promise<TokenData>;
    private persistTokens;
    /** The stored bundle, only if this node issued it; a legacy or foreign entry reads as empty. */
    private readStoredTokens;
    private signedOutElsewhere;
    private dropLocalTokens;
    /**
     * Get a valid token. Returns the current token as-is.
     * The server rejects refresh attempts while the access token is still valid,
     * so we never proactively refresh. Instead, the WebHttpClient handles 401
     * responses reactively via the refreshToken transport hook.
     */
    private getValidToken;
    /**
     * Refresh the access token. Single-flight: every caller (including the HTTP
     * transport's 401 hook) goes through here.
     *
     * Refresh tokens are single-use (calimero-network/core#3083): each refresh
     * consumes the presented token and returns a new one, and replaying a consumed
     * token makes the server revoke the whole family. A refresh must therefore
     * happen exactly once per rotation, which needs three layers:
     *  - an in-process promise, so concurrent 401s in this instance share one call;
     *  - a Web Lock (when available), so other tabs/webviews don't refresh at the
     *    same time on the same stored token;
     *  - a re-read of the token store inside the lock, so a bundle that another
     *    instance already rotated is adopted instead of replaying a stale token.
     */
    private performTokenRefresh;
    /**
     * Run `fn` under the refresh lock: the token store's own (shared across
     * processes), else the cross-tab Web Lock, else directly.
     */
    private withRefreshLock;
    /**
     * Perform the actual token refresh. Runs with the refresh lock held.
     */
    private performTokenRefreshLocked;
    /**
     * Clear the current token
     */
    clearToken(): void;
    /**
     * Check if the SDK is authenticated
     */
    isAuthenticated(): boolean;
    /**
     * Set token data directly (e.g., from auth callback).
     * If `expires_at` is missing or 0, attempts to parse the JWT exp claim,
     * falling back to 1 hour from now.
     */
    setTokenData(data: TokenData): void;
    /**
     * Get the current token data (for debugging)
     */
    getTokenData(): TokenData | null;
    /**
     * Close all event connections and clean up resources
     */
    close(): void;
    /**
     * Parse an auth callback URL hash fragment (static utility)
     */
    static parseAuthCallback(url: string, options?: ParseAuthCallbackOptions): AuthCallbackResult | null;
    /**
     * Build an auth login URL (static utility)
     */
    static buildAuthLoginUrl(nodeUrl: string, opts: AuthLoginOptions): string;
}
/**
 * Create a new MeroJs SDK instance
 */
export declare function createMeroJs(config: MeroJsConfig): MeroJs;
