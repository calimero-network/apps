import { HttpClient } from '../http-client/index.js';
import { HealthResponse, IdentityResponse, ProvidersResponse, TokenRequest, TokenResponse, RefreshTokenRequest, MockTokenRequest, RevokeTokenRequest, RevokeTokenResponse, CreateKeyRequest, CreateKeyResponse, DeleteKeyResponse, RootKey, ClientKey, GenerateClientKeyRequest, DeleteClientResponse, PermissionResponse, UpdateKeyPermissionsRequest } from './auth-types.js';
export declare class AuthApiClient {
    private httpClient;
    constructor(httpClient: HttpClient);
    getHealth(): Promise<HealthResponse>;
    getIdentity(): Promise<IdentityResponse>;
    getProviders(): Promise<ProvidersResponse>;
    getLoginPage(): Promise<string>;
    generateTokens(request: TokenRequest): Promise<TokenResponse>;
    refreshToken(request: RefreshTokenRequest): Promise<TokenResponse>;
    generateMockTokens(request: MockTokenRequest): Promise<TokenResponse>;
    validateToken(token: string): Promise<{
        valid: boolean;
        headers: Record<string, string>;
        status: number;
    }>;
    validateTokenGet(token: string): Promise<{
        status: number;
        headers: Record<string, string>;
    }>;
    revokeTokens(request: RevokeTokenRequest): Promise<RevokeTokenResponse>;
    listRootKeys(): Promise<RootKey[]>;
    createRootKey(request: CreateKeyRequest): Promise<CreateKeyResponse>;
    deleteRootKey(keyId: string): Promise<DeleteKeyResponse>;
    listClientKeys(): Promise<ClientKey[]>;
    generateClientKey(request: GenerateClientKeyRequest): Promise<TokenResponse>;
    deleteClientKey(keyId: string, clientId: string): Promise<DeleteClientResponse>;
    getKeyPermissions(keyId: string): Promise<PermissionResponse>;
    updateKeyPermissions(keyId: string, changes: UpdateKeyPermissionsRequest): Promise<PermissionResponse>;
}
