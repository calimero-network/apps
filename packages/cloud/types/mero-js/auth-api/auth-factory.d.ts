import { AuthApiClient } from './auth-client.js';
import { AuthApiClientConfig } from './auth-types.js';
import { HttpClient } from '../http-client/index.js';
export declare function createBrowserAuthApiClient(_config: AuthApiClientConfig): AuthApiClient;
export declare function createNodeAuthApiClient(_config: AuthApiClientConfig): AuthApiClient;
export declare function createAuthApiClient(_config: AuthApiClientConfig): AuthApiClient;
export declare function createAuthApiClientFromHttpClient(httpClient: HttpClient, _config: AuthApiClientConfig): AuthApiClient;
