export { ApiResponse } from '../http-client/index.js';
export interface HealthResponse {
    status: 'alive' | 'not_alive';
    storage: boolean;
    uptime_seconds: number;
}
export interface IdentityResponse {
    service: string;
    version: string;
    authentication_mode: string;
    providers: string[];
}
export interface ProvidersResponse {
    providers: Array<{
        name: string;
        type: string;
        description: string;
        configured: boolean;
        config: Record<string, unknown>;
    }>;
    count: number;
    /**
     * App origins, besides the node's own and the registry-declared frontends,
     * that this node's login page may hand a token pair to (`callback-url`):
     * exact `http(s)` origins from the node's
     * `[server.embedded_auth.development] trusted_callback_origins`. Absent on
     * nodes from before it existed; treat that as none.
     */
    trusted_callback_origins?: string[];
}
export interface TokenRequest {
    auth_method: string;
    public_key: string;
    client_name: string;
    permissions?: string[];
    timestamp: number;
    provider_data: Record<string, unknown>;
}
export interface TokenResponse {
    data: {
        access_token: string;
        refresh_token: string;
        error?: string | null;
    };
    error?: string | null;
}
export interface RefreshTokenRequest {
    access_token: string;
    refresh_token: string;
}
export interface MockTokenRequest {
    client_name: string;
    permissions?: string[];
    node_url?: string;
    access_token_expiry?: number;
    refresh_token_expiry?: number;
}
export interface RevokeTokenRequest {
    client_id: string;
}
export interface RevokeTokenResponse {
    success: boolean;
    message: string;
}
export interface CreateKeyRequest {
    /** Public key to register as a root key. */
    public_key: string;
    /** Auth method / provider name (e.g. "user_password"). */
    auth_method: string;
    /** Provider-specific data. */
    provider_data: Record<string, unknown>;
    /** Target node URL to scope the root key to (optional). */
    target_node_url?: string;
}
export interface CreateKeyResponse {
    status: boolean;
    message: string;
}
export interface DeleteKeyResponse {
    success: boolean;
    message: string;
}
export interface RootKey {
    key_id: string;
    public_key: string;
    auth_method: string;
    created_at: number;
    revoked_at?: number | null;
    permissions: string[];
}
export interface ClientKey {
    client_id: string;
    root_key_id: string;
    name: string;
    permissions: string[];
    created_at: number;
    revoked_at?: number | null;
    is_valid: boolean;
}
export interface GenerateClientKeyRequest {
    /** Context the client key is scoped to (optional). */
    context_id?: string;
    /** Context identity (executor public key) the client key is for (optional). */
    context_identity?: string;
    /** Additional permissions to request (validated against the root key). */
    permissions?: string[];
    /** Target node URL to scope the client key/tokens to (optional). */
    target_node_url?: string;
}
export interface DeleteClientResponse {
    success: boolean;
    message: string;
}
export interface UpdateKeyPermissionsRequest {
    /** Permission strings to add (OR-ed onto the key's current set). */
    add?: string[];
    /** Permission strings to remove (applied before `add`). */
    remove?: string[];
}
export interface PermissionResponse {
    data: {
        permissions: string[];
    };
    error?: string | null;
}
export interface AuthApiClientConfig {
    baseUrl: string;
    getAuthToken?: () => Promise<string | undefined>;
    timeoutMs?: number;
}
