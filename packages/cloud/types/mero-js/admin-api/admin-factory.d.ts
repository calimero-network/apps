import { AdminApiClient } from './admin-client.js';
import { AdminApiClientConfig } from './admin-types.js';
import { HttpClient } from '../http-client/index.js';
/** Admin client over a browser HTTP transport (global `fetch`). */
export declare function createBrowserAdminApiClient(config: AdminApiClientConfig): AdminApiClient;
/** Admin client over a Node HTTP transport (Node 18+ `fetch`). */
export declare function createNodeAdminApiClient(config: AdminApiClientConfig): AdminApiClient;
/** Admin client over whichever transport suits the current runtime. */
export declare function createAdminApiClient(config: AdminApiClientConfig): AdminApiClient;
/**
 * Admin client over a caller-supplied HTTP client — use this to share one
 * transport (and its token handling) with the other API clients.
 */
export declare function createAdminApiClientFromHttpClient(httpClient: HttpClient, _config: AdminApiClientConfig): AdminApiClient;
