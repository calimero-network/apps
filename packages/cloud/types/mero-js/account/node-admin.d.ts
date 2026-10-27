/**
 * A node's admin API, as an app writes against it: mero-js's `AdminApiClient`
 * with `createNamespace` made whole. On a node a namespace can only be created
 * for an application the node already holds, so this installs the provider's
 * package from the registry first when it is missing — the step an account
 * never sees, because founding through a relay names the package and the relay
 * fetches it. Same call, same result, on both.
 */
import type { AdminApiClient } from '../admin-api/index.js';
export interface NodeAdminDeps {
    latestVersion?: (registryUrl: string, pkg: string) => Promise<string>;
}
export declare function createNodeAdmin(input: {
    admin: AdminApiClient;
    app: {
        packageName?: string;
        packageVersion?: string;
        registryUrl?: string;
    };
}, deps?: NodeAdminDeps): AdminApiClient;
