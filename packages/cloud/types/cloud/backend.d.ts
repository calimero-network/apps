/**
 * The release-v2 (Calimero Cloud) backend behind the app-facing API the apps
 * were written against.
 *
 * The apps speak v1's vocabulary: namespaces, groups, contexts, an admin API
 * and a JSON-RPC transport. release-v2 has the same things under other names,
 * so this maps one onto the other instead of rewriting every app:
 *
 * | v1 (what an app calls)        | release-v2 (what runs)                        |
 * | ----------------------------- | --------------------------------------------- |
 * | namespace                     | organization (`orgId`)                        |
 * | its root group                | the organization itself (group id = `orgId`)  |
 * | subgroup                      | team (group id = `orgId.teamId`)              |
 * | context                       | app instance (context id = hex SHA-256(appId), which the cluster accepts wherever it takes an app id) |
 * | application id                | signed package (`package:<name>[@<version>]`), or a bundle hash on a development cluster |
 * | member identity               | account id                                    |
 * | signed open invitation        | invitation token (wrapped, see `invitationOf`)|
 * | `rpc.execute`                 | `POST /apps/{app}/intents`                    |
 * | `/sse` subscription           | `GET /apps/{app}/events` per context          |
 *
 * What release-v2 does not have yet answers with {@link NotOnCloudError}, named
 * for what was asked, rather than pretending to work.
 */
import { CalimeroClient, type CalimeroSession, type CloudPolicy, type PasskeyProvider } from '@calimero-network/mero-js';
import { classifyError } from './vendor/classify.js';
export * from './vendor/capabilities.js';
export { classifyError, messageOf, statusOf } from './vendor/classify.js';
export { AuthRevokedError, HTTPError, RelayLoginError, RequestAuthError } from './vendor/errors.js';
export { isSettled, shouldRetain } from './vendor/redeem-invitation.js';
type Json = any;
/** Something release-v2 does not offer (yet). The message names it. */
export declare class NotOnCloudError extends Error {
    readonly method: string;
    constructor(method: string, why?: string);
}
/** v1's JSON-RPC error: what an app call that the app refused looks like. */
export declare class RpcError extends Error {
    code: number;
    type?: string;
    data?: unknown;
    constructor(code: number, message: string, data?: unknown, type?: string);
}
/** v1 named accounts on a relay; kept so `instanceof` checks keep compiling. */
export declare class NotForAccountError extends Error {
    readonly method: string;
    constructor(method: string);
}
export declare class NoRelayError extends Error {
    readonly method: string;
    constructor(method: string);
}
export declare class InvitationNotClaimableError extends Error {
}
/**
 * Where the cluster is and how its quotes are judged.
 *
 * `VITE_CALIMERO_URL` names any node of the cluster. A development cluster
 * (`merod-v2 local`) produces mock quotes, which are trusted only when
 * `VITE_CALIMERO_ALLOW_MOCK=true` or the cluster is on this machine; a
 * production build passes a real `verifyQuote` through {@link configureCloud}.
 */
interface CloudConfig {
    url: string;
    policy: CloudPolicy;
    passkey: PasskeyProvider;
}
/**
 * Whether this build trusts mock quotes: only when it was built with
 * `VITE_CALIMERO_ALLOW_MOCK=true`, never by default and never because the
 * cluster looks local. A mock quote proves nothing about the node, so a build
 * that accepted one would hand a passkey ceremony (and everything after it) to
 * whoever answers at the URL.
 */
export declare function mockQuotesAllowed(): boolean;
/** Override the cluster, the quote policy or the passkey provider (tests, production builds). */
export declare function configureCloud(next: Partial<CloudConfig>): void;
export declare function defaultClusterUrl(): string;
/** A group id: the organization itself, or one of its teams. */
export declare function groupIdOf(org: string, team?: string | null): string;
export declare function parseGroupId(groupId: string): {
    org: string;
    team: string | null;
};
/** The context id the cluster derives for an app: hex SHA-256 of its id. */
export declare function contextIdOf(appId: string): Promise<string>;
/** The session: the one in memory, or a refreshable stub from this tab's storage. */
export declare function readSession(): CalimeroSession | null;
export declare function writeSession(session: CalimeroSession | null): void;
/**
 * The connected client, in the shape an app's `useMero().mero` had: `rpc` (an
 * `ExecuteTransport`, which generated ABI clients take), `admin`, `events`
 * and `ephemeral`.
 */
export declare class CloudMero {
    readonly client: CalimeroClient;
    readonly baseUrl: string;
    readonly admin: CloudAdmin;
    readonly rpc: CloudRpc;
    readonly events: CloudEvents;
    readonly ephemeral: LocalEphemeral;
    readonly isDelegated = false;
    private me;
    /** A cluster URL, or v1's `MeroJs` config (`{ baseUrl, tokenStore, timeoutMs }`). */
    constructor(urlOrConfig?: string | {
        baseUrl?: string;
    });
    get passkey(): PasskeyProvider;
    get session(): CalimeroSession | undefined;
    /** v1 handed out its token bundle; the cloud's session plays that part. */
    getTokenData(): {
        access_token: string;
        refresh_token: string;
        expires_at: number;
    } | null;
    signIn(): Promise<CalimeroSession>;
    signUp(name: string): Promise<CalimeroSession>;
    /** Whether the saved session still works, refreshing it if it has expired. */
    validate(): Promise<boolean>;
    signOut(): Promise<void>;
    /** `/auth/me`: the account, its passkeys and its organizations. */
    whoami(fresh?: boolean): Promise<Json>;
    accountId(): Promise<string>;
    /** Run a cluster request, refreshing an expired session once, and report failures as v1 did. */
    request<T>(path: string, run: () => Promise<T>): Promise<T>;
    get<T = Json>(path: string): Promise<T>;
    post<T = Json>(path: string, body?: unknown): Promise<T>;
    delete<T = Json>(path: string): Promise<T>;
    close(): void;
}
/** v1's `ExecuteTransport`: one method in one context. */
export declare class CloudRpc {
    private readonly mero;
    readonly kind = "node";
    readonly canSubscribe = true;
    constructor(mero: CloudMero);
    execute<T = unknown>(params: {
        contextId: string;
        method: string;
        argsJson?: Record<string, unknown>;
    }): Promise<T>;
    executeWithMeta<T = unknown>(params: {
        contextId: string;
        method: string;
        argsJson?: Record<string, unknown>;
    }): Promise<{
        result: T;
        index: number;
        events: Array<{
            kind: string;
            data: unknown;
        }>;
    }>;
    /** A read: release-v2 runs it as a strong view. */
    view<T = unknown>(params: {
        contextId: string;
        method: string;
        argsJson?: Record<string, unknown>;
    }): Promise<T>;
}
type Handler = (event: Json) => void;
/**
 * v1's `SseClient`, over each subscribed context's committed event stream.
 *
 * An event arrives as v1's `{ contextId, type: 'StateMutation', data: { events } }`
 * so `useSubscription` callbacks keep working: one per committed entry that
 * emitted, with the app's events inside.
 */
export declare class CloudEvents {
    private readonly mero;
    private readonly handlers;
    private readonly streams;
    private readonly cursor;
    private readonly seen;
    private readonly migration;
    private readonly version;
    constructor(mero: CloudMero);
    on(event: 'connect' | 'event' | 'error', handler: Handler): void;
    off(event: 'connect' | 'event' | 'error', handler: Handler): void;
    onAppVersionChanged(handler: Handler): () => void;
    onMigrationEvent(handler: Handler): () => void;
    connect(): Promise<void>;
    /** Follow these contexts (group subscriptions have no stream on release-v2: membership is read fresh). */
    subscribe(input: string[] | {
        contextIds?: string[];
        groupIds?: string[];
    }): Promise<void>;
    unsubscribe(input: string[] | {
        contextIds?: string[];
    }): Promise<void>;
    private follow;
    /** v1's `StateMutation`: the app's event, its payload as the bytes of its JSON. */
    private emit;
    close(): void;
}
/**
 * v1's ephemeral channel (presence, cursors, typing): peers broadcast short-lived
 * values that are never stored.
 *
 * release-v2 has no such channel yet, so this keeps the API and the local half:
 * a value set here is seen by this tab and by other tabs of this browser
 * (BroadcastChannel), not by other people. Apps keep working; presence shows
 * only you until the cluster grows the channel.
 */
export declare class LocalEphemeral {
    private readonly mero;
    readonly supported = false;
    private readonly channel;
    private readonly listeners;
    private readonly states;
    constructor(mero: CloudMero);
    private store;
    /** Publish this person's state for a context (v1: `ephemeral.set(contextId, value, codec)`). */
    set(contextId: string, state: unknown, _codec?: unknown): Promise<void>;
    /** Every author's latest state: a replay of what is known, then each change. */
    subscribe(contextId: string, listener: (entry: Json) => void, _codec?: unknown): () => void;
}
/**
 * v1 links carried a signed open invitation; release-v2 issues a token. The
 * token travels inside v1's shape so an app's own link codec, and every
 * `invitation.invitation.group_id` an app reads, keep working.
 */
export declare function invitationOf(token: string, groupId: string, expiresAt?: number): Json;
export declare function tokenOf(invitation: Json): string;
/**
 * An application id that names a signed package rather than one bundle:
 * `package:<name>` (any version the cluster has) or `package:<name>@<version>`.
 * The cluster verifies a package's publisher signature when it installs it and
 * each node verifies it again when it runs it, so this is what a production
 * page creates its apps from; a raw bundle hash is for development clusters.
 */
export declare const PACKAGE_PREFIX = "package:";
export declare function packageApplicationId(name: string, version?: string): string;
export declare function parsePackageApplicationId(id: string | null | undefined): {
    name: string;
    version?: string;
} | null;
/** The newest version the registry lists for `pkg` (v1's registry API). */
export declare function latestRegistryVersion(registryUrl: string, pkg: string): Promise<string>;
export declare const DEFAULT_REGISTRY_URL = "https://apps.calimero.network";
/**
 * Make `pkg` available on the cluster: a version it holds already, or
 * `version` (else the registry's newest) installed from the cluster's
 * registry, which every node verifies. Answers the package's application id.
 */
export declare function ensurePackage(mero: CloudMero, pkg: string, version?: string, registryUrl?: string): Promise<string>;
/**
 * v1's admin API over release-v2's organizations, teams and apps.
 *
 * Method for method what the apps call; anything else answers
 * {@link NotOnCloudError} through the proxy in {@link createCloudAdmin}.
 */
export declare class CloudAdmin {
    private readonly mero;
    constructor(mero: CloudMero);
    private org;
    private team;
    private apps;
    private appOf;
    getNodeIdentity(): Promise<Json>;
    getContextIdentitiesOwned(_contextId: string): Promise<Json>;
    getContextIdentities(contextId: string): Promise<Json>;
    generateContextIdentity(): Promise<Json>;
    listAccountDevices(): Promise<Json>;
    revokeAccountDevice(deviceId: string): Promise<Json>;
    /** Bundles this account can see in use, plus the one the page runs. */
    listApplications(): Promise<Json>;
    getApplication(applicationId: string): Promise<Json>;
    /** Install a signed package from the cluster's registry (v1's install from the registry). */
    installApplication(request?: Json): Promise<Json>;
    installFromRegistry(pkg: string, version?: string, registryUrl?: string): Promise<Json>;
    getRegistryVersions(pkg?: string): Promise<Json[]>;
    uninstallApplication(applicationId: string): Promise<Json>;
    resolveApplicationId(): Promise<string | null>;
    private namespace;
    listNamespaces(): Promise<Json[]>;
    /**
     * The organizations this application runs in, or that run nothing yet.
     *
     * An organization is not tied to one application on release-v2 (one
     * organization runs many apps), so "this app's namespaces" is those holding an
     * instance of it, plus empty ones a person just created.
     */
    listNamespacesForApplication(applicationId: string): Promise<Json[]>;
    namespacesForApplication(applicationId: string): Promise<Json[]>;
    getNamespace(namespaceId: string): Promise<Json>;
    createNamespace(request: {
        applicationId?: string;
        name?: string;
    }): Promise<Json>;
    deleteNamespace(namespaceId: string): Promise<Json>;
    leaveNamespace(namespaceId: string): Promise<Json>;
    createNamespaceInvitation(namespaceId: string, request?: {
        expirationTimestamp?: number;
        recursive?: boolean;
    }): Promise<Json>;
    joinNamespace(namespaceId: string, request: {
        invitation: Json;
    }): Promise<Json>;
    /** v1's one-call join with an outcome; the same classification of failures. */
    redeemInvitation(namespaceId: string, invitation: Json, _options?: Json): Promise<Json>;
    listGroupMembers(groupId: string): Promise<Json>;
    addGroupMembers(groupId: string, request: {
        members: Array<{
            identity: string;
            role?: string;
        }>;
    }): Promise<void>;
    removeGroupMembers(groupId: string, request: {
        members: string[];
    }): Promise<void>;
    updateMemberRole(groupId: string, identity: string, request: {
        role: string;
    }): Promise<void>;
    getMemberCapabilities(groupId: string, identity: string): Promise<Json>;
    setMemberCapabilities(groupId: string, identity: string, request: {
        capabilities: number;
    }): Promise<void>;
    getDefaultCapabilities(groupId: string): Promise<Json>;
    /** release-v2 keeps one default per organization; a team's default is its organization's. */
    setDefaultCapabilities(groupId: string, request: {
        defaultCapabilities: number;
    }): Promise<void>;
    getGroupInfo(groupId: string): Promise<Json>;
    syncGroup(groupId: string): Promise<Json>;
    getGroupMetadata(groupId: string): Promise<Json>;
    setGroupMetadata(groupId: string, request: {
        name?: string | null;
        data?: Record<string, string>;
    }): Promise<void>;
    setSubgroupVisibility(groupId: string, request: {
        subgroupVisibility: string;
    }): Promise<void>;
    getSubgroupVisibility(groupId: string): Promise<Json>;
    setGroupOpen(groupId: string, open: boolean): Promise<void>;
    createGroupInNamespace(namespaceId: string, request?: {
        groupName?: string;
        visibility?: 'open' | 'restricted';
        parentGroupId?: string;
    }): Promise<Json>;
    createOpenGroup(namespaceId: string, request?: Json): Promise<Json>;
    deleteGroup(groupId: string): Promise<Json>;
    reparentGroup(groupId: string, request: {
        newParentId: string;
    }): Promise<void>;
    listSubgroups(groupId: string): Promise<Json[]>;
    listNamespaceGroups(namespaceId: string): Promise<Json[]>;
    namespaceGroups(namespaceId: string): Promise<Json[]>;
    joinGroup(request: {
        invitation: Json;
    }): Promise<Json>;
    createGroupInvitation(groupId: string, request?: {
        expirationTimestamp?: number;
    }): Promise<Json>;
    /** An open team is reached through its parent: nothing to sign. */
    joinSubgroupInheritance(groupId: string): Promise<Json>;
    leaveGroup(groupId: string): Promise<Json>;
    groupVisibility(groupId: string): Promise<Json>;
    createContext(request: {
        applicationId: string;
        groupId: string;
        name?: string;
        initializationParams?: number[];
        serviceName?: string;
    }): Promise<Json>;
    /** A member of the organization (or team) reaches its apps already. */
    joinContext(contextId: string): Promise<Json>;
    leaveContext(contextId: string): Promise<Json>;
    deleteContext(contextId: string): Promise<Json>;
    getContext(contextId: string): Promise<Json>;
    getContexts(): Promise<Json>;
    listContexts(): Promise<Json>;
    getContextsForApplication(applicationId: string): Promise<Json>;
    listGroupContexts(groupId: string): Promise<Json[]>;
    groupContexts(groupId: string): Promise<Json[]>;
    getContextGroup(contextId: string): Promise<string | null>;
    contextGroup(contextId: string): Promise<string | null>;
    identitiesOwned(contextId: string): Promise<Json>;
    syncContext(): Promise<Json>;
    getContextMetadata(): Promise<Json>;
    setContextMetadata(): Promise<void>;
    setMemberMetadata(): Promise<void>;
    getMemberMetadata(): Promise<Json>;
    createContextAlias(): Promise<Json>;
    queryContext(contextId: string, method: string, args?: Record<string, unknown>): Promise<Json>;
    upgradeGroup(groupId: string, request: {
        targetApplicationId: string;
        migrateMethod?: string;
    }): Promise<Json>;
    getGroupUpgradeStatus(): Promise<Json>;
    uploadBlob(request: {
        data: Uint8Array | ArrayBuffer | Blob;
        contextId?: string;
    }): Promise<Json>;
    getBlob(blobId: string, options?: {
        contextId?: string;
    }): Promise<ArrayBuffer>;
    getBlobInfo(blobId: string, options?: {
        contextId?: string;
    }): Promise<Json>;
    deleteBlob(): Promise<Json>;
    setTeeAdmissionPolicy(): Promise<void>;
    getTeeAdmissionPolicy(): Promise<Json>;
    grantAuthorship(): Promise<void>;
    admitJoin(): Promise<Json>;
}
/** The admin client, with every method v1 had that release-v2 lacks naming itself. */
export declare function createCloudAdmin(mero: CloudMero): CloudAdmin;
/** v1's class name, for code that names the type; on release-v2 it is {@link CloudAdmin}. */
export declare const AdminApiClient: typeof CloudAdmin;
/** v1's client class name; on release-v2 it is {@link CloudMero}. */
export declare const MeroJs: typeof CloudMero;
export declare const MeroClient: typeof CloudMero;
export declare const SseClient: typeof CloudEvents;
/** The bundle this page creates apps from (`VITE_CALIMERO_BUNDLE`, or set at runtime). */
export declare function currentApplicationId(): string | null;
export declare function setCurrentApplicationId(id: string | null): void;
export declare function currentContextId(): string | null;
export declare function setCurrentContextId(id: string | null): void;
/**
 * Upload the page's own bundle (`wasmUrl`, served beside the page) and remember
 * its hash: the cluster stores a bundle once, so a repeat upload is cheap.
 */
export declare function ensureBundle(mero: CloudMero, wasmUrl: string): Promise<string>;
export declare function redeemInvitation(parsed: Json, redeemer: Json): Promise<Json>;
/** v1 found nodes on this machine; the cloud is one URL. */
export declare const DEFAULT_LOCAL_NODE_PORTS: number[];
export declare function discoverLocalNodes(): Promise<Json[]>;
export declare function localNodeUrl(): string;
export declare function nodeEndpoint(url: string): string;
export declare function probeNodeHealth(url: string): Promise<boolean>;
/** A v1 token store; the cloud keeps its session under `calimero-cloud:session`. */
export declare class LocalStorageTokenStore {
    getTokens(): Json;
    setTokens(): void;
    clear(): void;
}
export declare class MemoryTokenStore extends LocalStorageTokenStore {
}
export declare const readDelegatedSession: () => null;
export declare const readDelegatedCredential: () => null;
export declare const saveDelegatedSession: () => void;
export declare const saveDelegatedCredential: () => void;
export declare const clearDelegatedSession: () => void;
export declare const clearDelegatedCredential: () => void;
export declare const relayForContext: () => null;
export declare const rememberRelay: () => void;
export declare const readPinnedRelayNodeKey: () => null;
export declare const readRelayMap: () => Record<string, string>;
export declare const learnRelayNodeKey: () => Promise<null>;
export declare const listDelegatedContexts: () => Promise<Json[]>;
export declare const listDelegatedNamespaces: () => Promise<Json[]>;
export declare const buildDelegatedClient: () => null;
export declare const createAccountAdmin: (...args: unknown[]) => never;
export declare const createNodeAdmin: ({ admin }: {
    admin: Json;
}) => Json;
export declare const createDelegatedContext: (...args: unknown[]) => never;
export declare const createDelegatedPrivateContext: (...args: unknown[]) => never;
export declare const foundDelegatedNamespace: (...args: unknown[]) => never;
export declare const joinAsAccount: (...args: unknown[]) => never;
export declare const bootstrapFromInvitation: (...args: unknown[]) => never;
export declare const joinWithNode: (...args: unknown[]) => never;
export declare const resolveRelayFromInvitation: (...args: unknown[]) => never;
export declare const governRoot: (...args: unknown[]) => never;
export declare const governGroup: (...args: unknown[]) => never;
export declare const memberJoinedOpenOp: (...args: unknown[]) => never;
export declare const signGroupInvitation: (...args: unknown[]) => never;
export declare const signMemberJoinOp: (...args: unknown[]) => never;
export declare const signDeviceCert: (...args: unknown[]) => never;
export declare const signAccountLogin: (...args: unknown[]) => never;
export declare const verifyDeviceCredential: (...args: unknown[]) => never;
export declare const parseDeviceCredential: (...args: unknown[]) => never;
export declare const completeDeviceEnrolment: (...args: unknown[]) => never;
export declare const deviceEnrolmentUrl: (...args: unknown[]) => never;
export declare const readEnrolmentCallback: () => null;
export declare const carryExecutorAccount: <T>(session: T) => T;
export declare const accountRootFromPhrase: (...args: unknown[]) => never;
export declare const accountRootFromSecret: (...args: unknown[]) => never;
export declare const generateAccountRoot: (...args: unknown[]) => never;
export declare const mintDeviceId: (...args: unknown[]) => never;
export declare const pinRelayNodeKey: () => void;
export declare const resolveRelayNodeKey: () => Promise<null>;
export declare const routingProofHeaders: () => Promise<Record<string, string>>;
export declare const createMeroClient: () => CloudMero;
export declare const createBrowserHttpClient: (...args: unknown[]) => never;
export declare const createAuthApiClientFromHttpClient: (...args: unknown[]) => never;
export declare const createAttestedSealedFetch: (...args: unknown[]) => never;
export declare const createSignedReleaseVerifier: (...args: unknown[]) => never;
export declare const createLocalStorageNonceSource: (...args: unknown[]) => never;
export declare const createMemoryNonceSource: (...args: unknown[]) => never;
export declare const fetchNodeRelease: (...args: unknown[]) => never;
export declare const fetchNodeReleaseVersion: (...args: unknown[]) => never;
export declare const cloudNodeReleaseUrl: (...args: unknown[]) => never;
export declare const DEFAULT_RELEASE_MIRROR = "";
export declare const login: (...args: unknown[]) => never;
export declare const buildAuthLoginUrl: (...args: unknown[]) => never;
export declare const parseAuthCallback: () => null;
export declare const resolveApplicationIdFromRegistry: () => Promise<Json>;
export declare const applicationIdForBundle: (bundle: Json) => string;
export declare const selectLatestBundle: <T>(bundles: T[]) => T | undefined;
export declare const normaliseAccount: (account: string) => string;
export declare const signerFromSecret: (...args: unknown[]) => never;
export declare const compareSemver: (a: string, b: string) => number;
export declare const HA_ACCOUNT_NOT_LINKED_MESSAGE = "There is no high availability to link on Calimero Cloud: the cluster is always available.";
export declare const HA_REFUSAL_MESSAGES: Record<string, string>;
/** v1's cloud manager client (relay routing); nothing to route on release-v2. */
export declare class CloudClient {
    constructor(_options?: unknown);
    getNamespaceRouting(): Promise<Json>;
    getAccountRelays(): Promise<Json[]>;
}
export declare class RelayClient {
    constructor();
}
export declare const classify: typeof classifyError;
