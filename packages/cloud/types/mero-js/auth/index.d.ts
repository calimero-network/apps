export interface AuthCallbackResult {
    accessToken: string;
    refreshToken: string;
    applicationId: string;
    contextId: string;
    contextIdentity: string;
    nodeUrl: string;
}
export interface AuthLoginOptions {
    callbackUrl: string;
    packageName?: string;
    mode: string;
    permissions?: string[];
    registryUrl?: string;
    packageVersion?: string;
}
export interface ParseAuthCallbackOptions {
    /**
     * Accept tokens this browser did not ask for, for a host that injects them itself
     * (Calimero Desktop). Anyone who can open the page can then choose the session.
     */
    allowUnsolicited?: boolean;
}
/**
 * Parse an auth callback URL hash fragment.
 * Returns null if access_token is missing, or if the callback does not answer a
 * login begun here with {@link buildAuthLoginUrl} (single use, expires).
 */
export declare function parseAuthCallback(url: string, options?: ParseAuthCallbackOptions): AuthCallbackResult | null;
/**
 * Build the auth login URL for redirecting users to the node's auth page.
 * Remembers the login so {@link parseAuthCallback} can match the callback to it.
 */
export declare function buildAuthLoginUrl(nodeUrl: string, opts: AuthLoginOptions): string;
