/**
 * An in-memory Calimero Cloud cluster for app tests: the release-v2 REST routes
 * the cloud client calls (accounts, organizations, teams, invites, app
 * instances, packages), answered from plain objects, so a test drives an app's
 * real admin code through `@calimero-apps/cloud` without a node or a quote.
 *
 * ```ts
 * const cluster = installFakeCluster();      // patches CloudMero for this test
 * cluster.signIn('alice');
 * await createWorld(...);                     // the app's own code
 * expect(cluster.calls).toContainEqual(['POST', 'orgs', { name: 'w' }]);
 * cluster.uninstall();
 * ```
 *
 * It mirrors merod-v2's answers (`crates/cloud-node/src/api.rs`) closely
 * enough for app logic; it does not check access control beyond membership.
 */
type Json = any;
type Call = [method: string, path: string, body: unknown];
interface FakeTeam {
    teamId: string;
    name: string;
    parent: string | null;
    join: 'everyone' | 'invite';
    metadata: Json;
    members: Map<string, 'lead' | 'member' | 'readOnly'>;
}
interface FakeOrg {
    orgId: string;
    name: string;
    members: Map<string, 'owner' | 'admin' | 'member' | 'guest'>;
    teams: Map<string, FakeTeam>;
    defaultCapabilities: number;
    capabilities: Map<string, number>;
}
interface FakeApp {
    appId: string;
    contextId: string;
    name: string;
    owner: string;
    org: string | null;
    access: Json;
    bundle: string;
    package?: string;
    version?: string;
    initArgs: Json;
}
export interface FakeCluster {
    /** Every request, in order: `[method, path, body]`. */
    readonly calls: Call[];
    readonly orgs: Map<string, FakeOrg>;
    readonly apps: Map<string, FakeApp>;
    readonly packages: Map<string, string[]>;
    /** The account requests are made as. */
    signIn(account: string): void;
    /** Answer app calls (`rpc.execute`) and views (`rpc.view`). */
    onCall(handler: (call: {
        contextId: string;
        method: string;
        args: Json;
        caller: string;
    }) => unknown): void;
    /** Make the next request to `path` (a prefix) fail with `status`. */
    failNext(pathPrefix: string, status: number, message?: string): void;
    uninstall(): void;
}
/** Patch `CloudMero` and `CloudRpc` to answer from an in-memory cluster. */
export declare function installFakeCluster(): FakeCluster;
export {};
