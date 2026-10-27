import type { DcapCollateral } from '../sealed/verify.js';
export { ApiResponse } from '../http-client/index.js';
export interface HealthStatus {
    status: string;
}
/**
 * What `GET /admin-api/ready` reports: `ready` once the node has finished
 * starting up and its store answers. A node that is not ready answers `503`
 * with its lifecycle stage (or `store_unavailable`) as the status, which the
 * client surfaces as an `HTTPError`.
 */
export interface ReadinessStatus {
    status: string;
}
export interface AdminAuthStatus {
    data: {
        status: string;
    };
}
/**
 * Install by coordinates. The node fetches only from its own configured
 * `[registry]`, so there is no caller-supplied URL; both halves are required.
 */
export interface InstallApplicationRequest {
    package: string;
    version: string;
}
export interface InstallDevApplicationRequest {
    path: string;
}
export interface InstallApplicationResponseData {
    applicationId: string;
}
export interface UninstallApplicationResponseData {
    applicationId: string;
}
export interface ApplicationBlob {
    bytecode: string;
    compiled: string;
}
export interface Application {
    id: string;
    blob: ApplicationBlob;
    size: number;
    source: string;
    metadata: number[];
    /** Absent for a raw-wasm install (no signed bundle) and for bootstrap stubs. */
    signer_id?: string;
    /** Absent on a bootstrap stub row, written before the app's blob arrives. */
    package?: string;
    /** Absent when the stored version is empty or not valid semver. */
    version?: string;
    /** Named services of a multi-service bundle; absent for single-service apps. */
    services?: Record<string, ApplicationBlob>;
}
export interface ListApplicationsResponseData {
    apps: Application[];
}
export interface GetApplicationResponseData {
    application: Application | null;
}
/** One installed blob for an application (distinct from the package registry). */
export interface ApplicationVersionEntry {
    version: string;
    blobId: string;
    size: number;
    package: string;
}
export interface ListApplicationVersionsResponseData {
    data: ApplicationVersionEntry[];
}
/** The application's `wasm-abi/1` manifest, returned verbatim by the node. */
export type GetApplicationAbiResponseData = Record<string, unknown>;
export interface GetLatestVersionResponseData {
    applicationId: string | null;
    version: string | null;
}
export interface ListPackagesResponseData {
    packages: string[];
}
export interface ListVersionsResponseData {
    versions: string[];
}
/**
 * Per-service migration descriptor carried in a multi-service bundle manifest,
 * emitted from the app's `#[app::migrate]` declaration. `toSchemaVersion` is the
 * ABI state version the migrate targets (from `#[app::state(version = N)]`,
 * the engine's gate) — NOT the bundle semver, which is `toVersion`, the
 * user-facing string an admin matches on; `method` is the migrate entrypoint.
 */
export interface BundleMigration {
    method: string;
    toSchemaVersion: number;
    toVersion?: string;
}
/**
 * The subset of a registry bundle manifest that `getRegistryVersions` consumes.
 * The registry serves these at `GET {registry}/api/v2/bundles?package={package}`;
 * installation itself needs only the coordinates, which the node resolves.
 */
export interface RegistryBundleManifest {
    package: string;
    appVersion: string;
    /** Present when this bundle's app declares a migration. */
    migration?: BundleMigration;
}
export interface CreateContextRequest {
    applicationId: string;
    groupId: string;
    serviceName?: string;
    contextSeed?: string;
    initializationParams?: number[];
    identitySecret?: string;
    /** Optional human-readable label for the context. */
    name?: string;
}
export interface CreateContextResponseData {
    contextId: string;
    memberPublicKey: string;
    groupId?: string;
    groupCreated?: boolean;
}
export interface DeleteContextResponseData {
    isDeleted: boolean;
}
export interface Context {
    id: string;
    applicationId: string;
    serviceName?: string;
    /**
     * Context state/root hash. Core's wire key is `contextStateHash` (part of the
     * cross-DAG auth three-level naming: contextStateHash / groupStateHash /
     * namespaceStateHash). Renamed from `rootHash`, which never populated.
     */
    contextStateHash: string;
    /** Absent while the context has no deltas yet (core omits an empty list). */
    dagHeads?: number[][];
    /** Bundle semver of the installed application (skew #2). Absent on older nodes. */
    applicationVersion?: string;
}
export interface ContextWithGroup extends Context {
    groupId?: string;
}
export interface GetContextsResponseData {
    contexts: ContextWithGroup[];
}
export interface GenerateContextIdentityResponseData {
    publicKey: string;
}
export interface GetContextIdentitiesResponseData {
    identities: string[];
}
export interface JoinContextResponseData {
    contextId: string;
    memberPublicKey: string;
}
export interface JoinSubgroupInheritanceResponseData {
    groupId: string;
    memberPublicKey: string;
    wasInherited: boolean;
}
export type ContextGroupResponseData = string | null;
export interface ContextStorageResponseData {
    sizeInBytes: number;
}
export type SyncContextResponseData = null;
export interface UpdateContextApplicationRequest {
    applicationId: string;
    executorPublicKey: string;
}
export type UpdateContextApplicationResponseData = Record<string, never>;
export interface ResyncContextRequest {
    /** Force a full re-pull even if the context is not detected as stranded. */
    force?: boolean;
}
export interface ResyncContextResponseData {
    contextId: string;
    resyncStarted: boolean;
}
export interface ContextWithExecutors {
    contextId: string;
    executors: string[];
}
export type ContextsWithExecutorsResponseData = ContextWithExecutors[];
export interface UploadBlobRequest {
    /** Raw blob bytes; streamed verbatim as the request body (octet-stream). */
    data: Uint8Array | ArrayBuffer | Blob;
    /** Optional expected blob hash; sent as the `hash` query param for server-side verification. */
    hash?: string;
    /** Optional context to announce the blob to; sent as the `context_id` query param. */
    contextId?: string;
}
export interface BlobInfo {
    blobId: string;
    size: number;
}
export type UploadBlobResponseData = BlobInfo;
export interface DeleteBlobResponseData {
    blobId: string;
    deleted: boolean;
}
export interface ListBlobsResponseData {
    blobs: BlobInfo[];
}
export type GetBlobResponseData = BlobInfo;
/**
 * Optional context for a blob read. Supplying `contextId` sends the
 * `context_id` query param (the same one {@link UploadBlobRequest} announces
 * with) and opts the read into network discovery instead of a local-only
 * lookup — see {@link AdminClient.getBlob}/{@link AdminClient.getBlobInfo} for
 * the latency this buys.
 */
export interface BlobReadOptions {
    /** Context whose peers to probe for the blob; sent as the `context_id` query param. */
    contextId?: string;
}
export interface GetBlobInfoResponseData extends BlobInfo {
    /** Absent when the answer came from a peer probe, which carries only presence and size. */
    hash?: string;
    /** Absent when the answer came from a peer probe, which carries only presence and size. */
    mimeType?: string;
    /**
     * Where the node answered from, per the `x-blob-source` response header:
     * `'local'` for its own blob store, `'peer'` for a context probe. Undefined
     * on nodes that don't send the header.
     */
    source?: 'local' | 'peer';
}
export interface CreateContextAliasRequest {
    alias: string;
    contextId: string;
}
export interface CreateApplicationAliasRequest {
    alias: string;
    applicationId: string;
}
export interface CreateDeviceAliasRequest {
    alias: string;
    deviceId: string;
}
/**
 * Core's `ListAliasesResponse` is `{ data: BTreeMap<Alias<T>, T> }`, so once the
 * `data` envelope is stripped the payload is a flat `{ alias: id }` map — not a
 * list of entries. Applies to context, application, and device aliases.
 */
export type ListAliasesResponseData = Record<string, string>;
export type CreateAliasResponseData = Record<string, never>;
export type DeleteAliasResponseData = Record<string, never>;
export interface LookupAliasResponseData {
    value?: string;
}
/**
 * The signed half of an invitation. Wire keys are snake_case: this type mirrors
 * a core primitive (`calimero_context_config::types`), which carries no
 * camelCase rename — unlike the admin DTOs that wrap it.
 */
export interface GroupInvitationFromAdmin {
    readonly inviter_identity: number[];
    readonly group_id: number[];
    readonly expiration_timestamp: number;
    /** Per-invitation nonce; core keeps the legacy `secret_salt` wire name. */
    readonly secret_salt: number[];
    readonly invited_role: number;
    /**
     * Accounts permitted to admit a claim of this invitation, 64 hex characters
     * each — the same spelling every other account-addressing field uses.
     *
     * Empty means admission by broadcast: the joiner announces itself on the
     * namespace topic and any ready peer answers — which publishes the invitation
     * to every subscriber of that topic. Naming admitters keeps it off the topic,
     * and the joiner presents it to one of them directly.
     *
     * Inside the inviter's signature, so it cannot be redirected.
     */
    readonly admitters?: readonly string[];
}
/**
 * An invitation blob the node signed. **Opaque: pass it through unchanged.**
 *
 * `inviter_signature` covers `invitation`, and the trailing bootstrap fields
 * (`application_id`, `app_key`) are needed by the joiner even though they sit
 * outside the signature — so a value that has been rebuilt field-by-field is
 * not the value the node signed. Rebuilding is what a schema derived from these
 * declarations does: an object schema drops the keys it wasn't told about, and
 * core may add more (both trailing fields were added this way). Carry the value
 * verbatim from the call that produced it to {@link JoinGroupRequest}, and treat
 * the fields below as read-only detail for display.
 *
 * The `never`-typed brand makes that structural: an object literal or a schema
 * result cannot satisfy this type, while a value the SDK returned — or one
 * recovered with `JSON.parse` after transport — still does.
 */
export interface SignedGroupOpenInvitation {
    readonly invitation: GroupInvitationFromAdmin;
    readonly inviter_signature: string;
    /**
     * libp2p addresses for the accounts in
     * {@link GroupInvitationFromAdmin.admitters}, each a full multiaddr including
     * its `/p2p/<peer-id>` suffix.
     *
     * The peer id travels with the address because a joiner cannot derive it:
     * resolving an account to a peer needs governance state, which is exactly what
     * a joiner has not synced yet.
     *
     * Outside the signature, like the other bootstrap fields. A wrong address
     * costs a failed dial — libp2p authenticates the peer id on connect, and the
     * admitting node still has to be in the signed list for its admission to
     * count.
     *
     * Best-effort: absent on invitations from nodes predating the field, and empty
     * when the minting node had no address for any admitter.
     */
    readonly admitter_addrs?: readonly string[];
    /**
     * The account the inviter acts as, as 64 hex characters — not the
     * `inviter_identity` key inside the signed body is written in. Governance
     * rows name accounts, and a joiner cannot derive this one: an account is a
     * hash of a root it has never seen.
     *
     * Unsigned bootstrap field, and outside the signature deliberately — a
     * client that round-trips an invitation through its own typed model would
     * drop an unknown field and invalidate the signature with it. Absent on
     * invitations from older nodes.
     */
    readonly inviter_account?: string;
    /** Unsigned bootstrap field; absent on invitations from older nodes. */
    readonly application_id?: number[];
    /** Unsigned bootstrap field; absent on invitations from older nodes. */
    /**
     * The wire name is `app_key`; core's Rust field is `bytecode_id` behind a
     * `rename` that covers both directions, and core pins this spelling in a test.
     * `Option<[u8; 32]>` crosses JSON as an array of byte values, not as hex —
     * unlike `AccountId`, which has its own hex representation.
     */
    readonly app_key?: number[];
    /** @internal Brand — never present at runtime, never write it. */
    readonly __nodeSigned: never;
}
export interface RecursiveInvitationEntry {
    groupId: string;
    invitation: SignedGroupOpenInvitation;
    groupName?: string;
}
export interface Namespace {
    namespaceId: string;
    appKey: string;
    targetApplicationId: string;
    /**
     * Absent from nodes that have dropped the concept, always `"LazyOnAccess"` on
     * every released one. Optional because this SDK talks to both; it carries no
     * information either way. Delete once no supported release still sends it.
     */
    upgradePolicy?: string;
    createdAt: number;
    name?: string;
    memberCount: number;
    contextCount: number;
    subgroupCount: number;
    /**
     * Bundle version of this namespace's `appKey` blob — the per-namespace truth,
     * where the application row only says "latest fetched". Absent when core
     * cannot resolve it (raw-wasm app, legacy key, blob not retained locally).
     */
    appVersion?: string;
    /** Package of the release the namespace targets; present before that release is installed here. */
    appPackage?: string;
    /**
     * What the namespace id was derived from, on nodes that hold it. Every
     * namespace's id is derived from its founder since core's schema v10, so
     * this is absent only on nodes that predate it.
     */
    founding?: NamespaceFounding;
    /**
     * Group ops this node logged but holds unapplied, because their group's
     * history is sealed under a key it lacks: their effects are missing here until
     * that key arrives. What explains a subgroup that looks stale on this node and
     * current on another. Absent when nothing is held, and on nodes that predate it.
     */
    heldOps?: NamespaceHeldOps;
    /**
     * The user removed this namespace from this node and the account is still a
     * member. Set only by {@link AdminApiClient.listNamespacesForApplication};
     * {@link AdminApiClient.restoreNamespace} brings it back.
     */
    forgotten?: boolean;
}
/** The group ops a namespace holds unapplied on the node that answered. */
export interface NamespaceHeldOps {
    ops: NamespaceHeldOp[];
    /** Holds past the node's listing bound, counted but not listed. */
    untracked: number;
}
export interface NamespaceHeldOp {
    /** Hex id of the namespace op in the governance DAG. */
    deltaId: string;
    /** Hex id of the group whose sealed history it waits on. */
    groupId: string;
}
/**
 * The founder and salt a namespace id was derived from:
 * `domain_hash("calimero.namespace.id.v1", [founder, salt]) === namespaceId`.
 *
 * Anyone holding both can confirm which account founded the namespace without
 * holding any of its state. Neither is secret, and the salt cannot be replayed
 * for another account: the id commits to the founder.
 */
export interface NamespaceFounding {
    /** Hex `AccountId` of the founder. */
    founderAccountId: string;
    /** Hex 32-byte salt. */
    salt: string;
}
export type ListNamespacesResponseData = Namespace[];
/**
 * Who this node is: the account it writes as, the device it is, and the key it
 * signs with.
 *
 * Every field is node-level. One root key means one account, everywhere, and a
 * node signs with one key — so none of this varies by namespace, which is why
 * the endpoint behind it takes none.
 */
/**
 * A member's request that a node run one method on their behalf.
 *
 * Delegated authorship exists for a holder that cannot run the application
 * itself — a device with only a signing key, which can neither compile the WASM
 * nor decrypt the state. What makes the resulting write *theirs* is the warrant:
 * a statement they signed, which travels with the change so every peer verifies
 * they consented rather than taking the node's word.
 */
export interface PerformIntentRequest {
    /** The method to run. */
    method: string;
    /** Its arguments, as the JSON the guest will receive. */
    argsJson: unknown;
    /**
     * The author's consent: hex-encoded borsh of a `Warrant`.
     *
     * Opaque on purpose. Its canonical form is those bytes — the signature covers
     * them — so re-describing the fields as JSON would create a second spelling
     * that could disagree with what was signed.
     *
     * Mint it with {@link signWarrant}, or out of band with `merod account
     * warrant` / `meroctl context intent`.
     *
     * Signing here needs no dependency, which is why it is available at all: the
     * hash is WebCrypto SHA-256, the signature is WebCrypto Ed25519, and every
     * field of a warrant is fixed-width so the encoding is concatenation rather
     * than borsh. The byte contract is pinned on the node's side, at
     * `crates/account/src/tests/warrant_wire_fixture.rs`, because a drift there
     * would otherwise surface here as a 403 rather than as an encoding error.
     */
    warrant: string;
    /**
     * Hex-encoded borsh of the author's `AccountProof<DeviceCert>`, proving the
     * key that signed the warrant is a device of the account it names.
     *
     * Only the author's own half. The node attaches its own credential, which must
     * match the `executor` and `executor_key` the warrant names.
     */
    authorProof: string;
}
/** What a performed intent reports back. */
/**
 * A read of a context, run as the caller's account. Needs no warrant: a read
 * publishes nothing, so there is no peer to convince.
 */
export interface QueryContextRequest {
    /**
     * The method to call. It must be declared read-only in the application's ABI
     * (a `&self` method in a Rust app); anything else is refused with a `409`,
     * because a write needs a warrant ({@link PerformIntentRequest}).
     */
    method: string;
    /** Its arguments, as the JSON the guest will receive. */
    argsJson: unknown;
}
/**
 * `POST /admin-api/contexts/:contextId/grants` — let whoever holds the returned
 * token call these methods in the context, as the node that issued it.
 */
export interface CreateAccessGrantRequest {
    /**
     * Bare method names (`[A-Za-z0-9_]`). Each must be one the caller's own token
     * may execute in the context, or the node refuses with `403`.
     */
    methods: string[];
    /** The grantor's own note, for listing. Never shown to the holder. */
    label?: string;
    /** Unix seconds after which the grant is refused. Absent: until revoked. */
    notAfter?: number | null;
}
/** One access grant, as its grantor sees it. The token is never in here. */
export interface AccessGrant {
    /** Hex. What {@link AdminApiClient.revokeAccessGrant} names. */
    grantId: string;
    methods: string[];
    label: string;
    /** Unix seconds. */
    createdAt: number;
    /** Unix seconds; `null` means until revoked. */
    notAfter: number | null;
}
export interface CreatedAccessGrant extends AccessGrant {
    /**
     * Hex. The credential the holder presents. The node keeps only its hash, so
     * this is the one time it can be read.
     */
    token: string;
}
export interface RevokeAccessGrantResponseData {
    grantId: string;
}
/** `POST /admin-api/contexts/:contextId/grant-calls`. */
export interface AccessGrantCallRequest {
    /** Hex, as {@link AdminApiClient.createAccessGrant} returned it. */
    token: string;
    /** One of the methods the grant names. */
    method: string;
    /** Its arguments, as the JSON the guest will receive. */
    argsJson: unknown;
}
export interface AccessGrantCallResponseData {
    /** The method's own return value. */
    returns: unknown | null;
}
export interface QueryContextResponseData {
    /** The method's own return value. */
    returns: unknown | null;
}
export interface PerformIntentResponseData {
    /**
     * The context's scope root after the run — how a caller sees that it wrote.
     *
     * Worth asserting on rather than the status alone: an accepted intent that
     * advanced no state is a real failure mode, and it is cheaper to catch here
     * than on a later read of a value that was never written.
     */
    rootHash: string;
    /** The method's own return value, if it had one. */
    returns: unknown | null;
}
/**
 * What a node says about running intents in one context — read before minting a
 * warrant, not after being refused one.
 *
 * Every input to a warrant is something the author already holds except three:
 * whose account and key go in `executor` and `executor_key`, which release it
 * pins, and whether that node may act here at all. The node knows them, so they
 * are answered here, on the path the intent will be presented to.
 *
 * Reading it first is what lets a client fail before signing. A warrant spends a
 * nonce from a monotonic per-device sequence, and one naming the wrong executor
 * is unspendable — the number is gone and the write never happened.
 */
export interface IntentRelayInfo {
    /** The account a warrant for this node must name as its `executor`, 64 hex. */
    executorAccount: string;
    /**
     * The signing key a warrant for this node must name as its `executor_key`, 64
     * hex: the one device that may spend it. A re-key voids unspent warrants.
     */
    executorKey: string;
    /**
     * Whether this node holds `CAN_AUTHOR_ON_BEHALF` on the group owning the
     * context.
     *
     * `false` is an answer, not an error, and it is the *default* state of every
     * context — the capability is implied by neither membership nor admin, and is
     * not propagated by the subgroup cascade. A client reads it to tell "ask an
     * admin of `groupId`" from "retry later".
     */
    canAuthorOnBehalf: boolean;
    /** The group whose admin must grant that capability, 64 hex. */
    groupId: string;
    /**
     * The blob id of the release that group names, 64 hex: what a warrant for this
     * node must pin as `release_bytecode_id`. The route answers 404 while the group
     * names no release.
     */
    releaseBytecodeId: string;
    /** That release's semver, for the warrant's `release_version`. */
    releaseVersion: string;
}
export interface NodeIdentity {
    /**
     * The account this node writes as, 64 hex characters. This — not
     * `publicKey` — is what member-addressing endpoints take, and what
     * `listGroupMembers` entries are keyed by, so it is how a caller locates
     * itself in a member list.
     */
    accountId: string;
    /**
     * The device this node is, 64 hex characters, or `null` before it has
     * enrolled anywhere.
     *
     * `null` is a real answer rather than a missing one: the account id above
     * exists as soon as the node has a root, and enrolment — which a join
     * performs — is what adds the device that speaks for it.
     */
    deviceId: string | null;
    /**
     * The key this node signs ops with, 64 hex.
     *
     * The device's signing key, not the account root: the root signs
     * certificates and never an op, so a signature on the wire verifies against
     * this one.
     */
    publicKey: string;
    /**
     * The epoch-0 root **public** key of this node's account, 64 hex characters.
     *
     * What a second device needs to pair into this account, and public by
     * construction — it is hashed into `accountId` and travels in every genesis.
     * The private root never leaves the node over HTTP.
     *
     * Optional because a node at or below `0.11.0-rc.22` does not send it: the
     * field landed after that release. Required in the type would make this SDK
     * claim something the node the caller chose may not report.
     */
    accountRootPublicKey?: string;
    /**
     * Whether this node holds the root key of the account it speaks for. `false`
     * means it runs on a delegate device key, so it cannot certify another device
     * into the account — which is what a pairing invite needs to know before
     * offering the option.
     *
     * Optional for the same reason as `accountRootPublicKey`: a node at or below
     * `0.11.0-rc.30` does not send it. `undefined` is therefore "this node is too
     * old to say", which is not the same answer as `false`, and a caller gating an
     * invite on it should not collapse the two.
     */
    holdsAccountRoot?: boolean;
    /**
     * Whether this node's device is certified into the account it speaks for.
     *
     * Pair-init mints a device but only pair-complete certifies it, and
     * `holdsAccountRoot` is `false` across both states, so this is what tells
     * them apart. Absent on a node predating the field.
     */
    deviceCertified?: boolean;
    /**
     * Hex X25519 public agreement key of this node's device, `null` before it
     * has a device row.
     *
     * The same key pairing calls `kemPublicKey`; core's name is kept here.
     */
    deviceAgreementKey?: string | null;
    /**
     * Hex id of the account namespace this node follows.
     *
     * A holder derives it before the namespace exists so an invite can carry
     * it; a device records it at pair-init. `null` on a node that neither holds
     * a root nor has paired with the id; absent on an old node.
     */
    accountNamespaceId?: string | null;
    /**
     * The account that withdrew this node's device, absent on a node no
     * revocation has reached.
     */
    revokedFrom?: RevokedFromEntry;
}
/** Which account withdrew this node's device, and which device it was. */
export interface RevokedFromEntry {
    /** The account the device spoke for, 64 hex characters. */
    accountId: string;
    /** The device that was withdrawn, 64 hex characters. */
    deviceId: string;
}
export interface CreateNamespaceRequest {
    applicationId: string;
    name?: string;
    /** Hex 32-byte blob id; pins the namespace to a specific installed version. */
    appKey?: string;
}
export interface CreateNamespaceResponseData {
    namespaceId: string;
    /** What the id was derived from. Absent on nodes that predate derived ids. */
    founding?: NamespaceFounding;
}
export interface DeleteNamespaceResponseData {
    isDeleted: boolean;
}
export interface CreateNamespaceInvitationRequest {
    expirationTimestamp?: number;
    recursive?: boolean;
}
export interface CreateNamespaceInvitationResponseData {
    invitation: SignedGroupOpenInvitation;
    groupName?: string;
}
export interface CreateRecursiveInvitationResponseData {
    invitations: RecursiveInvitationEntry[];
}
export interface JoinNamespaceRequest {
    invitation: SignedGroupOpenInvitation;
    groupName?: string;
}
export interface JoinNamespaceResponseData {
    /**
     * The namespace that was joined.
     *
     * core `0.11.0-rc.25` renamed this field on the wire from `groupId`
     * (core#3598). The endpoint had been sharing a response DTO with
     * `POST /admin-api/groups/join`, which leaked the internal "a namespace is a
     * root group" detail into the namespace API and meant a caller could not use
     * one spelling across the family.
     *
     * {@link AdminClient.joinNamespace} fills this in from whichever spelling the
     * node sent, so it is populated against nodes on either side of that release.
     */
    namespaceId: string;
    /**
     * @deprecated The pre-`0.11.0-rc.25` spelling of {@link namespaceId}. Present
     * only when the node predates that release — read `namespaceId` instead,
     * which is always set.
     */
    groupId?: string;
    /** The key the joiner signs with, 64 hex. */
    memberIdentity: string;
    /**
     * The account that key joined as, 64 hex characters. This — not
     * `memberIdentity` — is what every member-addressing endpoint takes, so it
     * is how the caller addresses the member it just became.
     */
    memberAccount: string;
    /** The name a restored namespace had when it was removed. Set only by a restore. */
    name?: string;
}
export interface CreateGroupInNamespaceRequest {
    groupName?: string;
    /**
     * Subgroup visibility at birth. Absent means `'open'` (core 0.11 and later;
     * older nodes default to `'restricted'`). Pass `'restricted'` for a private
     * subgroup, and choose here rather than flipping it afterwards: a subgroup
     * created Restricted and flipped Open strands namespace members outside it.
     */
    visibility?: 'open' | 'restricted';
}
export interface CreateGroupInNamespaceResponseData {
    groupId: string;
}
export interface SubgroupEntry {
    groupId: string;
    name?: string;
}
/**
 * Adopt an account that already lives on another device, and mint this node a
 * device of its own for it.
 *
 * The first half of pairing, run on the joining node. It publishes nothing and
 * needs no key: it produces the values the account holder's
 * {@link AdminApiClient.completeAccountPairing} certifies, plus a confirmation
 * code to read out to them.
 *
 * Account-level, and that is the whole point of it: both credentials pairing
 * mints were always account-wide - the certificate is root-signed and the
 * endorsement node-level, so neither ever named a namespace - while the older
 * per-namespace route still made the caller name one, and the device then
 * listened on that one topic while its holder's link fanned out across all of
 * them.
 */
export interface AccountPairInitRequest {
    /**
     * The epoch-0 root **public** key of the account to join, 64 hex characters -
     * exactly what {@link NodeIdentity.accountRootPublicKey} reports on the node
     * that already holds the account.
     *
     * Named for the half it carries. An ed25519 private and public key are both 32
     * bytes and both hex, so nothing but the name tells them apart; the private
     * root never crosses this boundary at all.
     */
    accountRootPublicKey: string;
    /**
     * Ids of the namespaces to enroll into, 64 hex characters each.
     *
     * The caller has to supply these, because the joining node cannot discover
     * them - it is a member of nothing and holds no scope key, so it can neither
     * read the account's namespace set off a DAG nor derive it. The device that
     * already holds the account is the only party that knows it.
     *
     * This decides what the new device *listens* on, and it does not have to agree
     * with the applications the holder scopes `pair-complete` to: a binding
     * published where the device is not listening is picked up whenever it does
     * subscribe, and a subscription the holder never reaches costs nothing.
     *
     * Core refuses only a request that names neither this nor `accountNamespace`.
     * A caller that sends `accountNamespace` may leave this empty.
     */
    namespaces?: string[];
    /**
     * Hex id of the account namespace to follow - the value
     * {@link NodeIdentity.accountNamespaceId} reports on the holder.
     *
     * The device then learns the account's namespaces from the account namespace
     * itself, so the caller need not know them up front. A caller that does not
     * send this must name at least one namespace above.
     */
    accountNamespace?: string;
}
/**
 * What the joining device minted, for the account holder to certify.
 *
 * These are round-trip tokens: a caller copies them verbatim into
 * {@link AdminApiClient.completeAccountPairing}. The signing key is the NEW
 * device's, so it appears in no member listing yet and there is nothing here to
 * compare it against.
 *
 * One device is minted however many namespaces were named, so there is one of
 * each of these to hand over, not one per namespace.
 */
export interface AccountPairInitResponseData {
    /** The account this device will speak for once linked, 64 hex characters. */
    accountId: string;
    /** The device that was minted, 64 hex characters. */
    deviceId: string;
    /** X25519 agreement key a scope key must be wrapped under to reach this device, hex. */
    kemPublicKey: string;
    /**
     * The Ed25519 key this device signs its ops with, hex.
     *
     * The account holder cannot derive this - it is minted here - and the
     * certificate names it, so it has to travel with the other two.
     */
    signPublicKey: string;
    /**
     * The time the device signed, then its Ed25519 signature over the account, the
     * device id, both keys above and that time, hex (8 + 64 bytes). The holder's
     * node refuses a statement older than a few minutes.
     *
     * Carried so the three values arrive as a statement by the device that minted
     * them rather than as assertions by whoever relayed them; `pair-complete`
     * refuses without it.
     */
    statement: string;
    /**
     * The value to read out to the account holder, who compares it against what
     * their `pair-complete` reports.
     *
     * The part a substituting attacker cannot fake: it can re-sign its own
     * statement, but it would have to make its own keys derive the code the other
     * side is already reading.
     */
    confirmationCode: string;
}
/**
 * Certify a device another node minted, link it, and deliver its scope keys.
 *
 * The second half of pairing, run on the node that holds the account root - the
 * only party that can sign the certificate that makes the device real. Every
 * field but `applications` is copied verbatim from that other node's
 * {@link AccountPairInitResponseData}.
 */
export interface AccountPairCompleteRequest {
    /** The `deviceId` the other node minted, 64 hex characters. */
    deviceId: string;
    /** That device's X25519 agreement key, 64 hex characters. */
    kemPublicKey: string;
    /** That device's Ed25519 signing key, 64 hex characters. */
    signPublicKey: string;
    /**
     * The signature from that node's pair-init, 128 hex characters (64 bytes).
     *
     * Not optional: without it the three values above are only claims by whoever
     * sent them, and certifying those would make attacker-supplied keys a trusted
     * device of this account.
     */
    statement: string;
    /**
     * The code the account holder read off the pairing device, e.g.
     * `7BC0-DAAC-CCB4-84A4`. Grouping and case are ignored.
     *
     * Required so the comparison cannot be skipped: this side re-derives the code
     * for the key material that actually arrived and refuses a mismatch. Its value
     * rests on the code reaching the holder independently of this payload - sent
     * beside the keys, it proves nothing. One code covers the whole pairing,
     * because one device was minted for it.
     */
    confirmationCode: string;
    /**
     * Which applications this device may speak for, 64 hex each. Omitted or empty means
     * every one of them.
     *
     * Scoped by application rather than by namespace because a person can answer
     * "which apps may this device use" and cannot answer "which namespaces" - a
     * namespace is an implementation unit they never named. The node resolves
     * these to namespaces through the same lookup
     * {@link AdminApiClient.listNamespacesForApplication} reads.
     */
    applications?: string[];
}
/** What pairing established. */
export interface AccountPairCompleteResponseData {
    /** The account the device now speaks for, 64 hex characters. */
    accountId: string;
    /** The device that was linked, 64 hex characters. */
    deviceId: string;
    /**
     * Whether the current scope key was wrapped and published for the device.
     *
     * `false` does not mean pairing failed - the link is what confers authority,
     * and the device's own sync pull re-requests the key. It does mean the device
     * cannot read until that lands.
     */
    keyDelivered: boolean;
    /**
     * The code for the key material this certified - the same value the request
     * carried, echoed so the operator can see what the certificate names.
     */
    confirmationCode: string;
    /**
     * The `AccountProof<DeviceCert>` this pairing minted, hex-encoded borsh.
     *
     * The certified device needs this to present itself as a device of the
     * account, and cannot read it off the DAG: doing so means being a member of a
     * group the account speaks in, which a thin client never is. Not a secret - a
     * certificate is public and proves nothing without the device key it names.
     */
    credential: string;
}
/**
 * A domain an outside verifier defined, which the account root may sign under.
 *
 * A name from a closed set, never the domain bytes. The node prepends the bytes
 * itself: "sign these bytes with the account root" would be a signing oracle
 * over the one key that can certify a device, which is account takeover. A node
 * refuses any name it does not know.
 *
 * Typed as a union plus `(string & {})` so a node newer than this SDK can be
 * reached without a cast, while the known names still autocomplete.
 */
export type ExternalSigningDomain = 'mdma.account-link' | 'mdma.account-login' | 'mdma.account-recovery' | (string & {});
/**
 * Ask this node's account root to sign a payload an outside verifier specified.
 *
 * The verifier owns the format; the node supplies only the domain. For the cloud
 * this is how a challenge it sealed and issued gets signed by a root that
 * deliberately never leaves the node holding it.
 */
export interface AccountSignWithRootRequest {
    /** Which verifier's domain to sign under. */
    domain: ExternalSigningDomain;
    /**
     * The bytes to sign after the domain, hex-encoded.
     *
     * Hex rather than text because the field is bytes. For the cloud's challenge —
     * an ASCII string — that is the UTF-8 of it, hex-encoded; {@link hexEncodeUtf8}
     * does exactly that and exists so each caller does not re-derive it.
     */
    payload: string;
}
/**
 * Hex-encode a string's UTF-8 bytes, for {@link AccountSignWithRootRequest.payload}.
 *
 * Exists so each caller does not write the same loop. Every verifier this is
 * used with issues its challenge as text, and the node takes bytes — getting
 * that conversion subtly wrong (UTF-16 code units, a stray newline from a shell)
 * produces a signature over the wrong message, which fails at the verifier with
 * nothing local to point at.
 */
export declare function hexEncodeUtf8(text: string): string;
/** What the node signed, and the key to check it against. */
export interface AccountSignWithRootResponseData {
    /** The account root's public key, 64 hex characters. */
    rootPublicKey: string;
    /**
     * The signature over `domain ‖ payload`, **base64**.
     *
     * Base64 rather than hex because that is what the consuming verifiers decode;
     * re-encoding it on the way out is a step that fails silently at the far end.
     */
    signature: string;
    /** The account the signing key belongs to, 64 hex characters. */
    accountId: string;
}
/**
 * Repair or widen the reach of a device this account already certified.
 *
 * Pairing is a snapshot: it bound the device wherever this node took part at the
 * time, so a namespace created or joined afterwards holds no binding for it and
 * the paired device silently never sees that namespace. This re-runs the fan-out
 * against the namespaces this node takes part in now. The device need not be
 * online, and nothing but its id is required - the certificate is already held
 * here, root-signed and naming no namespace, so a fresh endorsement and a key
 * wrap are all a later namespace is missing.
 */
export interface RelinkDeviceRequest {
    /**
     * Applications to add to the device's stored scope, 64 hex each.
     *
     * **Omitted or empty changes nothing** and repairs against the scope already
     * stored, which is the request an operator makes to heal drift. Note that this
     * is the one place an empty list does not mean "all": widening a narrow scope
     * to every application is deliberately not expressible here, because
     * overloading the empty list would make the accidental request the widest one.
     */
    applications?: string[];
}
/**
 * The scope to hold: every application, or only the ones named.
 *
 * A tagged shape rather than a list whose emptiness means everything - `all`
 * and `only: []` differ by a whole order of magnitude in what they grant, and
 * an empty `only` is refused rather than treated as `all`.
 */
export type DeviceScope = 'all' | {
    only: string[];
};
/**
 * Replace a device's scope outright, in one root-signed op.
 *
 * {@link relinkAccountDevice} only ever adds applications; this is how a
 * scope is narrowed, or an `all` device is given a fixed list instead.
 */
export interface RescopeDeviceRequest {
    scope: DeviceScope;
}
/** One namespace the relink published the device's link into. */
export interface RelinkOutcomeEntry {
    /** The namespace id, 64 hex characters. */
    namespaceId: string;
    /**
     * Whether the scope key was wrapped and published for the device here.
     *
     * `false` means the link landed and the delivery did not; the link is what
     * confers authority, and the device's own sync pull re-requests the key.
     */
    keyDelivered: boolean;
}
/** One namespace the relink published nothing into, and why. */
export interface RelinkSkipEntry {
    /** The namespace id, 64 hex characters. */
    namespaceId: string;
    /**
     * Why nothing was published there. Currently one of `outOfScope`,
     * `alreadyBound`, `noScopeKey`, `revoked`, `ownDevice`, `failed`; left as a
     * string because a node may report a reason newer than this SDK.
     */
    reason: string;
}
/** One namespace a scope replacement no longer reaches. */
export interface RescopeDescopeEntry {
    /** The namespace id, 64 hex characters. */
    namespaceId: string;
    /**
     * Whether the scope key was rotated. `false` means the device stopped writing
     * there but still holds the key it had, until an admin rotates.
     */
    keyRotated: boolean;
}
/** The scope a device now holds, and what each namespace did about it. */
export interface RescopeDeviceResponseData {
    /** The account the device speaks for, 64 hex characters. */
    accountId: string;
    /** The device that was rescoped, 64 hex characters. */
    deviceId: string;
    /** The scope after the request, 64 hex each. Empty means every application. */
    applications: string[];
    /** Namespaces the new scope no longer reaches. */
    descoped: RescopeDescopeEntry[];
    /** Namespaces the device was linked into by this call. */
    linkedIn: RelinkOutcomeEntry[];
    /** Namespaces nothing was published into, and why. */
    skipped: RelinkSkipEntry[];
}
/** What the relink repaired, and what it left alone. */
export interface RelinkDeviceResponseData {
    /** The account the device speaks for, 64 hex characters. */
    accountId: string;
    /** The device that was repaired, 64 hex characters. */
    deviceId: string;
    /**
     * The device's scope after the request, 64 hex each. Empty means every
     * application, which is what a pairing that named none asked for.
     */
    applications: string[];
    /**
     * Namespaces the link was published into by this call. Reported per namespace
     * because publication is per-DAG, so which namespaces a device actually
     * reached is a state the caller has to be able to see.
     */
    linkedIn: RelinkOutcomeEntry[];
    /** Namespaces nothing was published into. */
    skipped: RelinkSkipEntry[];
}
/**
 * One device of this account, joined from the node-local certificate cache and
 * the live bindings of every namespace this node takes part in.
 */
export interface AccountDeviceEntry {
    /** This device's id, 64 hex characters. */
    deviceId: string;
    /** The key this device signs its ops with, 64 hex. */
    signingKey: string;
    /** Set only on the device this node itself presents. */
    isSelf: boolean;
    /**
     * Whether this device has been withdrawn from the account.
     *
     * A revoked device stays in the listing rather than vanishing from it, so a
     * settings UI can render "revoked" as a state of a known device instead of
     * silently losing the row. Never filter on this by default: a device that
     * disappeared and a device that was withdrawn are different facts, and only
     * the second one is a fact the account holder took an action to create.
     *
     * Revocation is **forward-only**. It withdraws the device's authority to
     * write from here on; it does not retract, unsign or rewrite anything the
     * device already authored, and ops it signed before the revocation stay valid
     * and stay in the DAG. `revoked: true` therefore means "may not act any more",
     * never "never acted" - do not build UI that implies the past was undone.
     */
    revoked: boolean;
    /**
     * Applications this device may speak for, 64 hex each. **Empty means every
     * application**, the same convention the stored certificate uses - and the
     * opposite of what an empty {@link RelinkDeviceRequest.applications} asks for.
     * Empty also for a device this node holds no cached certificate for: one bound
     * before the cache existed, or certified by another holder.
     */
    applications: string[];
    /**
     * Ids of the namespaces currently holding a live binding for this device, 64
     * hex characters each. Empty for a certified device not yet bound anywhere.
     */
    namespaces: string[];
    /**
     * The replicated name the account gave this device, absent while it has
     * none. Every device of the account reads the same one.
     */
    label?: string;
}
/**
 * Name a device of this account, for a listing to render.
 *
 * Run on the node holding the account root to name any device; a paired node
 * is accepted only for that device's own id.
 */
export interface LabelDeviceRequest {
    /** Trimmed, non-empty, bounded and free of control characters. */
    label: string;
}
/**
 * The name that was published, and the epoch that orders it against a rename
 * another device of the account made at the same time.
 */
export interface LabelDeviceResponseData {
    /** The account the device speaks for, 64 hex characters. */
    accountId: string;
    /** The device that was named, 64 hex characters. */
    deviceId: string;
    label: string;
    labelEpoch: number;
}
/**
 * One application this account speaks in, derived from the namespaces this node
 * takes part in that target it.
 *
 * An application installed with no namespace yet is absent here: it has no
 * cross-device meaning until a namespace exists, so there is nothing to scope a
 * device to.
 */
export interface AccountApplicationEntry {
    /** The application id, 64 hex. */
    applicationId: string;
    /** Ids of the namespaces targeting it, 64 hex characters each. */
    namespaces: string[];
}
/**
 * Withdraw a device from an account, terminally.
 *
 * Terminal in one direction only: revocation is **forward-only**. It stops the
 * device acting from here on and does not retract past authorship - every op it
 * already signed keeps verifying and stays in the DAG, because the certificate
 * that authorised it was valid when the signature was made. There is no
 * "un-author" in this system, so no revocation UI should promise one.
 */
export interface RevokeAccountDeviceRequest {
    /** The device to withdraw, 64 hex. */
    deviceId: string;
    /**
     * A hex-encoded, borsh-serialized signed revocation minted elsewhere -
     * the output of `merod account revoke-proof`.
     *
     * The lost-device path: the account root that owns the device is not on this
     * node, so the proof is signed offline and this node only publishes it. Omit
     * it and the node mints its own proof if it owns the account, and otherwise
     * revokes as an admin.
     *
     * Not a credential and not a secret - it authorises this one revocation of
     * this one device, and only alongside a stored binding naming the same
     * account.
     */
    proof?: string;
}
/** What a revocation withdrew in one namespace. */
export interface RevocationOutcome {
    /** The namespace, 64 hex. */
    namespaceId: string;
    /**
     * Whether the scope key rotated in the same op, in THIS namespace.
     *
     * `false` means the device stopped writing there at once but still holds the
     * key it had, so it can keep READING until an admin rotates. Only an admin
     * may rotate and an account holder revoking their own device usually is not
     * one, so this is commonly owed rather than exceptional.
     */
    keyRotated: boolean;
}
export interface RevokeAccountDeviceResponseData {
    /** The account the device spoke for, 64 hex. */
    accountId: string;
    /** The device that was withdrawn, 64 hex. */
    deviceId: string;
    /**
     * Whether the scope key rotated in the namespace named in the request.
     *
     * {@link revokedIn} is the full picture; prefer it. This reports only the one
     * namespace the caller asked about and is retained because core keeps it for
     * a released `calimero-client-py` wheel that requires the field.
     */
    keyRotated: boolean;
    /**
     * Every namespace the revocation was published into.
     *
     * A device belongs to an account rather than to a scope, so revoking it
     * withdraws it from every namespace holding a binding for it - not only the
     * one named in the request. Per namespace because publication is per-DAG: a
     * namespace absent here did not receive the op, and a partially propagated
     * revocation is a state the caller has to be able to see.
     */
    revokedIn: RevocationOutcome[];
}
/**
 * Bind a device of an account the node does not hold, so what that device
 * signs in the namespace resolves to its account.
 *
 * For an account with **no node**: its root certifies a device offline
 * (`signDeviceCert`) and scopes it
 * (`signDeviceScope`), and a relay that is a member of the namespace carries
 * the link, endorsing the account with its own member key. Both proofs are
 * root-signed, so the relay can carry them and cannot alter them.
 */
export interface LinkAccountDeviceRequest {
    /**
     * The device's credential: hex, borsh `AccountProof<DeviceCert>` — what
     * `signDeviceCert` returns and `merod account sign-cert` prints.
     */
    credential: string;
    /**
     * The device's scope: hex, borsh `AccountProof<DeviceScope>` — what
     * `signDeviceScope` returns. It must reach the namespace's application, or
     * name none.
     */
    scope: string;
}
export interface LinkAccountDeviceResponseData {
    /** The account the device speaks for, 64 hex. */
    accountId: string;
    /** The device now bound, 64 hex. */
    deviceId: string;
    /**
     * The namespace already bound this device key, so nothing was published.
     * A repeat call is harmless and answers `true`.
     */
    alreadyBound: boolean;
}
/** One device of one member account, as the group's live bindings record it. */
export interface MemberDeviceEntry {
    /** The device id, 64 hex - the form {@link RevokeAccountDeviceRequest.deviceId} takes. */
    deviceId: string;
    /**
     * The key this device's signatures carry, 64 hex. This is the join column
     * against the identities a context reports, which name bare signing keys and
     * nothing else.
     */
    signingKey: string;
}
/** One member account of a group, with the devices currently bound for it. */
export interface MemberDevicesEntry {
    /** The member's account id, 64 hex - the same id a group member listing names. */
    account: string;
    /**
     * Devices holding a live binding for this account. Only live ones: a revoked
     * device is gone from here, unlike {@link AccountDeviceEntry} which keeps it
     * with `revoked: true`. So this answers "who may act now", never "who ever
     * did" - a past author may well be absent.
     */
    devices: MemberDeviceEntry[];
}
/** Paging for a member-device listing. Both are optional; the node defaults them. */
export interface ListMemberDevicesOptions {
    /** How many entries to skip. */
    offset?: number;
    /** How many entries to return. The node clamps this to its own maximum. */
    limit?: number;
}
export interface CreateGroupRequest {
    applicationId: string;
    appKey?: string;
    name?: string;
    parentGroupId?: string;
    /**
     * A nested group's visibility at birth. Absent means `open`: every member of
     * the parent is a member of the subgroup by inheritance. `restricted` admits
     * only those added or invited to it. Ignored without `parentGroupId`.
     * Needs core 0.11.0-rc.85 or later (core#4543); an older node refuses the
     * field. `createGroupInNamespace` takes it on older nodes too.
     */
    visibility?: 'open' | 'restricted';
}
export interface CreateGroupResponseData {
    groupId: string;
}
export interface GroupUpgradeStatus {
    fromVersion: string;
    toVersion: string;
    initiatedAt: number;
    initiatedBy: string;
    status: string;
    /** Contexts THIS NODE enumerated for the upgrade. Node-local; fleet progress
     * is the `getMigrationStatus` rollup. The counters and `completedAt` come
     * from the upgrade propagator only: a plain group upgrade swaps each context
     * lazily, on its next execution, and reports `completed` without any of them. */
    localContextsTotal?: number;
    localContextsSwapped?: number;
    /** Contexts whose swap failed on this node; a non-zero value is what
     * `retryGroupUpgrade` picks up. */
    localContextsFailed?: number;
    /** Unix seconds at which THIS NODE finished its own context swaps, when the
     * propagator ran them (absent on a lazy upgrade, see above). Not fleet
     * convergence - that is `MigrationStatus.fleetCompletedAt`. */
    completedAt?: number;
}
export type MemberMigrationState = 'migrated' | 'in_progress' | 'unknown' | 'failed';
/** Why a member's migration did not complete. */
export type MigrationFailureReason = 'check_aborted' | 'apply_failed' | 'no_migration_path';
export interface MemberMigrationReport {
    /** ABI state version the member has loaded, from `#[app::state(version = N)]` -
     * the engine's migration gate, not the bundle semver and not a CRDT concept.
     * The wrong reading here is how the core rollup defect (comparing bundle-semver
     * majors instead of state versions) went unnoticed. */
    schemaVersion: number;
    residueAuto: number;
    syncedUpToHlc: number;
    reportedAt: number;
    /** Member's self-reported pending-authored count (best-effort; skew #1). */
    authoredRemaining: number;
    /**
     * Set when the member's migrate did not complete (its migration-check
     * aborted, or the apply errored). Absent otherwise.
     */
    migrationFailed?: MigrationFailureReason;
}
export interface MemberMigrationStatusEntry {
    /** The reporting device's signing KEY, bs58. One account with two devices
     * appears as two rows: the cohort is replicas, not people. */
    peer: string;
    /** The ACCOUNT `peer` speaks for, 64 hex - join it to `listGroupMembers` to
     * name a person. Absent from nodes predating the field. */
    account?: string;
    /** Freshest reported facts. Omitted (not `null`) when the member's state is
     * `unknown`, so test falsiness rather than `=== null`. */
    report?: MemberMigrationReport | null;
    state: MemberMigrationState;
}
export interface MigrationStatusRollup {
    migrated: number;
    inProgress: number;
    unknown: number;
    /** Members whose migrate aborted (migration-check failed or apply errored). */
    failed: number;
    total: number;
    allMigrated: boolean;
    /** Count of members with authoredRemaining > 0 (owners still to re-sign). */
    membersPendingSignature: number;
}
export interface MigrationStatus {
    targetVersion: number;
    expectedMembers: number;
    /** Governance HLC the cohort was pinned at, as an opaque display string.
     * Absent when there is no migration record. */
    cohortPinnedAtHlc?: string;
    /** Unix seconds at which this node watched the FLEET converge, absent while it
     * has not. Distinct from `GroupUpgradeStatus.completedAt`, which is this node's
     * own local swap completion. Durable, unlike `rollup.allMigrated`, which is
     * recomputed from in-TTL heartbeats and lapses when a member goes quiet. */
    fleetCompletedAt?: number;
    rollup: MigrationStatusRollup;
    members: MemberMigrationStatusEntry[];
}
export interface NamespaceRevokedDevices {
    /** Device ids (64 hex) revoked in the namespace. */
    revokedDevices: string[];
    /** Hex `sha256(account || device)` of each device its own account withdrew in the namespace. */
    withdrawnSlots: string[];
}
export interface CascadeStatusEntry {
    groupId: string;
    upgrade: GroupUpgradeStatus;
    cascadeHlc?: string;
}
export interface GroupInfo {
    groupId: string;
    appKey: string;
    targetApplicationId: string;
    /**
     * Absent from nodes that have dropped the concept, always `"LazyOnAccess"` on
     * every released one. Optional because this SDK talks to both; it carries no
     * information either way. Delete once no supported release still sends it.
     */
    upgradePolicy?: string;
    memberCount: number;
    contextCount: number;
    activeUpgrade?: GroupUpgradeStatus;
    defaultCapabilities: number;
    /** How the group takes members: `'open'` inherits the parent's, `'restricted'` admits directly. */
    subgroupVisibility: string;
    /**
     * Who outside the group can reach it: `'restricted'` when this group or any
     * group above it (short of the namespace root) is Restricted, `'open'` only on
     * an Open chain to the namespace. Draw privacy (a lock) from this, not from
     * `subgroupVisibility`: an Open folder inside a private one is `'open'` there
     * and `'restricted'` here. Absent from nodes that predate it.
     */
    effectiveVisibility?: 'open' | 'restricted';
    /**
     * The group's generic metadata record (replaces the old `alias` field).
     * `null` if no metadata has ever been set for this group.
     */
    metadata?: MetadataRecord | null;
    /** Hex hash of the group's authorization-relevant state, for convergence polling. */
    groupStateHash?: string;
    /**
     * The namespace this group belongs to (itself, for a namespace root). An
     * owner-op root proof binds it. Absent from nodes before core schema 18.
     */
    namespaceId?: string;
    /**
     * How many root-guarded owner ops this group has applied: the `counter` a
     * root proof for its next one must name. Absent from nodes before core
     * schema 18.
     */
    ownerOpCounter?: number;
    /** Package of the release the group targets; present before that release is installed here. */
    appPackage?: string;
    /** Version of the release the group targets; absent until governance names one. */
    appVersion?: string;
}
export type GroupInfoResponseData = GroupInfo;
/**
 * A group member's role, as the node serializes it (PascalCase).
 *
 * The two TEE roles are minted by hardware-attestation admission only, never by
 * an invitation or a role change:
 * - `ReadOnlyTee` — a TEE **replica**: replicates and anchors sync, never
 *   relays a member's write (a relay intent to one is refused with a 403).
 * - `RelayTee` — a TEE **relay**: a replica that may also author members'
 *   writes under their signed warrants, with no `CAN_AUTHOR_ON_BEHALF` grant.
 *   Admitted when the namespace's {@link TeeAdmissionMode} is `relay`.
 */
export type GroupMemberRole = 'Admin' | 'Member' | 'ReadOnly' | 'ReadOnlyTee' | 'RelayTee';
export interface GroupMember {
    /**
     * The member's ACCOUNT: 64 hex characters.
     *
     * Not a signing key — a person may hold several keys
     * and governance rows name the person. Both are 32 bytes, so nothing here or
     * on the server will object if you pass the wrong one; it will simply name a
     * principal that exists nowhere. Feed this value to
     * {@link RemoveGroupMembersRequest} and {@link UpdateMemberRoleRequest}, not
     * to {@link GroupMemberInput}.
     */
    identity: string;
    role: GroupMemberRole;
    name?: string;
}
export interface ListGroupMembersResponseData {
    members: GroupMember[];
    /**
     * @deprecated The server response uses `members`, not `data`. This alias
     * is retained so existing callers compile during the upgrade window; it
     * is never populated by the client and will be removed in the next
     * major. Switch reads to `response.members`.
     */
    data?: GroupMember[];
}
/** One device bound to a member account. */
export interface MemberDevice {
    /** 64 hex; the form `revokeAccountDevice` takes. */
    deviceId: string;
    /**
     * The key this device's signatures carry, 64 hex. Joins against the
     * identities a context lists.
     */
    signingKey: string;
}
/** A member account and the devices bound to it in the namespace. */
export interface MemberDevicesEntry {
    /** The member's ACCOUNT, 64 hex. */
    account: string;
    devices: MemberDevice[];
}
export interface ListMemberDevicesResponseData {
    /**
     * Every account in the group if the calling node is an admin; only its own
     * entry if it is a plain member.
     */
    members: MemberDevicesEntry[];
}
export interface SealToAccountRequest {
    /**
     * Hex-encoded plaintext. Small by design: the route exists to hand an account
     * something like a list of namespace ids, and the node caps the size.
     */
    plaintext: string;
}
/**
 * A payload sealed to an account's root key. Only that account's root can open
 * it; the node that sealed it cannot.
 */
export interface SealedEnvelope {
    /**
     * The root-key epoch it was sealed under. A rotated root still opens envelopes
     * from its own epoch, so a recipient holding several needs to know which.
     */
    accountRootEpoch: number;
    /** Hex, 32 bytes: the one-shot sender key. */
    ephemeralPublicKey: string;
    /** Hex, 12 bytes: the AES-256-GCM nonce. */
    nonce: string;
    /** Hex: the ciphertext with its 16-byte tag appended. */
    ciphertext: string;
}
export interface GroupContextEntry {
    contextId: string;
    name?: string;
}
export type ListGroupContextsResponseData = GroupContextEntry[];
export interface DeleteGroupResponseData {
    isDeleted: boolean;
}
export interface GroupMemberInput {
    /**
     * The invitee's signing KEY, 64 hex — NOT an account. It is spelled exactly
     * like one, so only the field name says which this is.
     *
     * Adding is the one member-facing call that names a key: the node binds the
     * key to an account as it admits it, so before that there is no account to
     * name. Every call that names an EXISTING member takes the account instead.
     */
    identity: string;
    role: string;
}
export interface AddGroupMembersRequest {
    members: GroupMemberInput[];
}
export type AddGroupMembersResponseData = Record<string, never>;
export interface RemoveGroupMembersRequest {
    /**
     * The members to remove, as ACCOUNTS (64 hex) — the same ids
     * {@link GroupMember.identity} returns, and not the keys
     * {@link GroupMemberInput.identity} took to add them.
     */
    members: string[];
}
export type RemoveGroupMembersResponseData = Record<string, never>;
export interface UpdateMemberRoleRequest {
    role: string;
}
export type UpdateMemberRoleResponseData = Record<string, never>;
export interface MemberCapabilities {
    capabilities: number;
}
export interface SetMemberCapabilitiesRequest {
    capabilities: number;
}
export type SetMemberCapabilitiesResponseData = Record<string, never>;
export interface SetDefaultCapabilitiesRequest {
    defaultCapabilities: number;
}
export type SetDefaultCapabilitiesResponseData = Record<string, never>;
export interface SetMemberAutoFollowRequest {
    /** Auto-join contexts registered in this group. */
    autoFollowContexts: boolean;
    /** Self-admit into subgroups nested under this group. */
    autoFollowSubgroups: boolean;
}
export type SetMemberAutoFollowResponseData = Record<string, never>;
export interface SetSubgroupVisibilityRequest {
    subgroupVisibility: string;
}
export type SetSubgroupVisibilityResponseData = Record<string, never>;
/**
 * The signed-release form of a TEE admission policy: admit a TEE running any
 * mero-tee node release the mero-tee release workflow signed, if its quote
 * matches one of `allowedProfiles` in that release's `published-mrtds.json`.
 * Unlike the measurement lists, it does not need updating for each release.
 */
export interface SignedReleaseTeePolicy {
    /** Image profiles to admit, e.g. `locked-read-only`. */
    allowedProfiles: string[];
    /** The oldest release admitted (`2.3.72`); any signed release when absent. */
    minReleaseVersion?: string;
}
/**
 * Which role a namespace admits attested TEE nodes with: `replica`
 * (`ReadOnlyTee`, the default) or `relay` (`RelayTee`, which may also author
 * members' writes under their warrants). Part of the admin-signed policy, so
 * every node admits with the same role; changing it converts the TEEs already
 * admitted.
 */
export type TeeAdmissionMode = 'replica' | 'relay';
/** A policy that lists the measurements it admits. */
export interface MeasurementTeeAdmissionPolicyRequest {
    allowedMrtd: string[];
    allowedRtmr0: string[];
    allowedRtmr1: string[];
    allowedRtmr2: string[];
    allowedRtmr3: string[];
    allowedTcbStatuses: string[];
    acceptMock: boolean;
    /** Absent means `replica`. */
    mode?: TeeAdmissionMode;
    /**
     * Hex borsh of the signing admin's own root proof for this policy op
     * ({@link signOwnerOpProof} with the matching policy encoder). Omit it on a
     * node that holds that admin's account root, which signs one itself.
     */
    rootProof?: string;
}
/** A policy that admits by signed release. The node refuses measurement lists beside it. */
export interface SignedReleaseTeeAdmissionPolicyRequest {
    signedRelease: SignedReleaseTeePolicy;
    allowedTcbStatuses: string[];
    acceptMock: boolean;
    /** Absent means `replica`. */
    mode?: TeeAdmissionMode;
    /**
     * Hex borsh of the signing admin's own root proof for this policy op
     * ({@link signOwnerOpProof} with the matching policy encoder). Omit it on a
     * node that holds that admin's account root, which signs one itself.
     */
    rootProof?: string;
}
export type SetTeeAdmissionPolicyRequest = MeasurementTeeAdmissionPolicyRequest | SignedReleaseTeeAdmissionPolicyRequest;
export type SetTeeAdmissionPolicyResponseData = Record<string, never>;
export interface GetTeeAdmissionPolicyResponseData {
    /** `false` when no policy is set; the rest are then empty. */
    enabled?: boolean;
    allowedMrtd: string[];
    allowedRtmr0: string[];
    allowedRtmr1: string[];
    allowedRtmr2: string[];
    allowedRtmr3: string[];
    allowedTcbStatuses: string[];
    acceptMock: boolean;
    /** Set when the policy admits by signed release; the lists are then empty. */
    signedRelease?: SignedReleaseTeePolicy;
    /**
     * The role admitted TEEs receive. `replica` for a policy set before the mode
     * existed; absent only from a node that predates it.
     */
    mode?: TeeAdmissionMode;
}
/**
 * Which admitted TEEs may author as the group's TEE authority (the writer behind
 * `TeeOnly` storage and `#[app::tee]` methods). A TEE whose attested MRTD is in
 * `allowedMrtd` may author; an empty list turns TEE authorship off.
 *
 * Namespace-scoped: set it on the namespace root. The node refuses it on a subgroup.
 */
export interface SetTeeAuthoringPolicyRequest {
    allowedMrtd: string[];
    /**
     * Hex borsh of the signing admin's own root proof for this policy op
     * ({@link signOwnerOpProof} with the matching policy encoder). Omit it on a
     * node that holds that admin's account root, which signs one itself.
     */
    rootProof?: string;
}
/**
 * The root proof an owner-level op carries (core schema 18).
 *
 * A device key alone cannot transfer a group, repoint a namespace's admin,
 * delete a group through the owner-only path, or set a TEE policy: each needs a
 * proof signed by the account's ROOT key. On a node that holds that root (as
 * `merod init` provisions) omit `rootProof` and the node signs it. Otherwise sign
 * one offline with {@link signOwnerOpProof}, over the group's current
 * `ownerOpCounter` and `namespaceId` from {@link GroupInfo}. Each proof applies
 * once. Without either, the node answers `403`.
 */
export interface RootGuardedOpRequest {
    /** Hex borsh of an `AccountProof<OwnerOpAuthorization>`. */
    rootProof?: string;
}
/** Hand a group to `newOwner`, an account (64 hex) that is already one of its admins. */
export interface TransferOwnershipRequest extends RootGuardedOpRequest {
    newOwner: string;
}
/** Repoint a namespace's admin pin at `newAdmin`, an account that is a member of its root. */
export interface ChangeNamespaceAdminRequest extends RootGuardedOpRequest {
    newAdmin: string;
}
/**
 * The owner-only deletion of a group that holds no contexts. The admin-level
 * cascading delete is {@link AdminApiClient.deleteGroup}.
 */
export type OwnerDeleteGroupRequest = RootGuardedOpRequest;
export type RootGuardedOpResponseData = Record<string, never>;
export type SetTeeAuthoringPolicyResponseData = Record<string, never>;
/**
 * Generic metadata record attached to a group, group member, or
 * context-registered-in-a-group (core `calimero_primitives::metadata::MetadataRecord`).
 *
 * `data` is application-defined and opaque to core — it is stored verbatim.
 * Server-enforced size limits: `name` <= 64 bytes; at most 64 entries in
 * `data`; each key <= 64 bytes; each value <= 4096 bytes. Clients do not need
 * to enforce these — the server validates.
 */
export interface MetadataRecord {
    name: string | null;
    data: Record<string, string>;
    updatedAt: number;
    /** Public key (hex) of the member that last updated the record. */
    updatedBy: string;
}
/**
 * Request body for setting a metadata record. **This wholly replaces the
 * record**: `data` defaults to `{}` server-side and replaces the stored map,
 * while omitting `name` keeps the current name. To change `name` while
 * preserving existing `data`, GET the record first and pass its `data` back.
 */
export interface SetMetadataRequest {
    name?: string;
    data?: Record<string, string>;
}
export type SetGroupMetadataRequest = SetMetadataRequest;
export type SetMemberMetadataRequest = SetMetadataRequest;
export type SetContextMetadataRequest = SetMetadataRequest;
export type SetMetadataResponseData = Record<string, never>;
/**
 * Inner payload of a GET metadata response. `data` is `null` if no metadata
 * has ever been set for the target group/member/context.
 */
export interface GetMetadataResponseData {
    data: MetadataRecord | null;
}
export interface SyncGroupResponseData {
    groupId: string;
    appKey: string;
    targetApplicationId: string;
    memberCount: number;
    contextCount: number;
}
export interface UpgradeGroupRequest {
    targetApplicationId: string;
    /** Fan the upgrade out to every descendant subgroup running the same app
     *  (one atomic cascade op). Without it the upgrade applies to the target
     *  group only - members' subgroups never learn the migration. Server
     *  default: false. */
    cascade?: boolean;
    /** Proceed code-only when the target build embeds no ABI. Core refuses such an
     *  upgrade by default; setting this asserts the new code is layout-compatible
     *  with the running state so the upgrade goes ahead. It never bypasses a
     *  declared-migration or downgrade refusal. Wire name is camelCase passthrough;
     *  older nodes ignore the unknown field. Server default: false. */
    forceCodeOnly?: boolean;
    /** Publish without first trialling the migration on the admin's own contexts.
     *  Server default: false, so a migration that fails the trial is refused with a 409. */
    skipTrial?: boolean;
}
export interface UpgradeGroupResponseData {
    groupId: string;
    status: string;
    localContextsTotal?: number;
    localContextsSwapped?: number;
    localContextsFailed?: number;
    contextsTrialled?: number;
    contextsNotHeld?: number;
}
export type GroupUpgradeStatusResponseData = GroupUpgradeStatus | null;
export type RetryGroupUpgradeResponseData = UpgradeGroupResponseData;
export interface ActivateGroupUpgradeRequest {
    /** Refuse with 409 unless this is the namespace's stored target application. */
    expectedApplicationId?: string;
    /** Refuse with 409 unless this is the target release's manifest version
     *  (application ids do not change between versions). */
    expectedVersion?: string;
}
export interface ActivateGroupUpgradeFailedContext {
    contextId: string;
    error: string;
    /** False when the switch itself failed (a migration or load); a retry repeats it. */
    retryable: boolean;
}
export interface ActivateGroupUpgradeResponseData {
    targetApplicationId: string;
    /** Contexts this call moved to the target; 0 when all were current. */
    switchedContexts: number;
    /** Held deltas replayed into the namespace's contexts. */
    replayedDeltas: number;
    /** Calling again retries only these. */
    failedContexts: ActivateGroupUpgradeFailedContext[];
}
export interface ReparentGroupRequest {
    /** 64-char id of the destination parent group. */
    newParentId: string;
}
export interface ReparentGroupResponseData {
    reparented: boolean;
}
export type DetachContextFromGroupResponseData = Record<string, never>;
export interface IssueOwnershipProofRequest {
    /** Who the proof is for. Non-empty, <= 256 characters. */
    audience: string;
    /** 64-hex context id the proof is scoped to. */
    contextId: string;
    /** What is being claimed. Non-empty, <= 512 characters. */
    subject: string;
    /** Caller-chosen hex nonce, 32-128 characters (even length). */
    nonce: string;
    /** Requested expiry, unix ms. Core clamps it to issue time + 5 minutes. */
    expiresAtMs: number;
}
/** Namespace-scoped sibling: identical minus `contextId`. */
export type IssueNamespaceOwnershipProofRequest = Omit<IssueOwnershipProofRequest, 'contextId'>;
export interface IssueOwnershipProofResponseData {
    /** Hex 32-byte ed25519 public key of the signer. */
    signerPublicKey: string;
    /**
     * Base64 opaque UTF-8 JSON bytes of the claim. Verifiers re-parse these exact
     * bytes and sign over `"calimero.ownership-claim.v1\0" || signedPayload`.
     */
    signedPayload: string;
    /** Base64 64-byte ed25519 signature. */
    signature: string;
    /**
     * Namespace proofs only: what the namespace id was derived from. Not signed;
     * the id commits to it. With {@link credential}, it is what lets the cloud
     * check that the signer is a node of the account that FOUNDED the namespace
     * (mdma refuses a namespace proof without both). Absent on nodes that predate
     * it, and on context proofs.
     */
    founding?: NamespaceFounding;
    /**
     * Namespace proofs only: hex borsh `AccountProof<DeviceCert>` — the node's join
     * credential, whose account root certifies `signerPublicKey`. See
     * {@link founding}.
     */
    credential?: string;
}
export interface CreateGroupInvitationRequest {
    expirationTimestamp?: number;
    recursive?: boolean;
    /**
     * Accounts permitted to admit a claim of this invitation, 64 hex each.
     *
     * Omitted or empty is filled in by the node from the group's admins and its
     * TEE nodes; it refuses to mint if that set comes back empty, because an empty
     * list on the wire authorises any node to admit. Naming admitters narrows that
     * set.
     *
     * Core signs this list into the invitation, so it cannot be redirected after
     * the fact.
     */
    admitters?: string[];
    /**
     * libp2p addresses for those admitters, each including its `/p2p/<peer-id>`
     * suffix.
     *
     * Omitted or empty asks the node to fill them in from addresses it already has
     * on file — which is usually what you want. Values supplied here are used as
     * given rather than merged, on the grounds that a caller naming an address is
     * correcting the node's view rather than extending it.
     *
     * Not signed, so a wrong address costs a failed dial and nothing more.
     */
    admitterAddrs?: string[];
}
export interface CreateGroupInvitationResponseData {
    invitation: SignedGroupOpenInvitation;
    groupName?: string;
}
export interface CreateRecursiveGroupInvitationResponseData {
    invitations: RecursiveInvitationEntry[];
}
export interface JoinGroupRequest {
    invitation: SignedGroupOpenInvitation;
    groupName?: string;
}
export interface JoinGroupResponseData {
    groupId: string;
    /** The key the joiner signs with, 64 hex. */
    memberIdentity: string;
    /**
     * The account that key joined as, 64 hex characters. This — not
     * `memberIdentity` — is what every member-addressing endpoint takes, so it
     * is how the caller addresses the member it just became.
     */
    memberAccount: string;
}
export interface TeeInfoResponseData {
    cloudProvider: string;
    osImage: string;
    mrtd: string;
}
export interface TeeAttestRequest {
    nonce: string;
    applicationId?: string;
    /**
     * Bind the node's X25519 transport key into the quote; the response names it
     * as `transportPublicKey`. See `fetchAttestedTransportKey`.
     */
    bindTransportKey?: boolean;
    /**
     * Also return the Intel-signed collateral the quote is verified against, as
     * `collateral`, so the quote can be verified with nothing but the node. See
     * `createQuoteVerifier`. A node that predates it refuses the field.
     */
    includeCollateral?: boolean;
}
export interface QuoteHeader {
    version: number;
    attestationKeyType: number;
    teeType: number;
    qeVendorId: string;
    userData: string;
}
export interface QuoteBody {
    tdxVersion: string;
    teeTcbSvn: string;
    mrseam: string;
    mrsignerseam: string;
    seamattributes: string;
    tdattributes: string;
    xfam: string;
    mrtd: string;
    mrconfigid: string;
    mrowner: string;
    mrownerconfig: string;
    rtmr0: string;
    rtmr1: string;
    rtmr2: string;
    rtmr3: string;
    reportdata: string;
    teeTcbSvn2?: string;
    mrservicetd?: string;
}
export interface Quote {
    header: QuoteHeader;
    body: QuoteBody;
    signature: string;
    attestationKey: string;
    certificationData: unknown;
}
export interface TeeAttestResponseData {
    quoteB64: string;
    quote: Quote;
    /** Hex X25519 transport key, present only when the request set `bindTransportKey`. */
    transportPublicKey?: string;
    /**
     * The Intel-signed collateral the quote verifies against, present only when
     * the request set `includeCollateral` and the quote is not a mock.
     */
    collateral?: DcapCollateral;
}
export interface AdminApiClientConfig {
    baseUrl: string;
    getAuthToken?: () => Promise<string | undefined>;
    timeoutMs?: number;
    /** Fetch every request goes through. Defaults to global `fetch`. */
    fetch?: typeof fetch;
}
/** A join signed by its subject, handed to an admitter to publish. */
export interface AdmitJoinRequest {
    /** The invitation being claimed. Must name the admitter in `admitters`. */
    readonly invitation: SignedGroupOpenInvitation;
    /**
     * The signed `SignedNamespaceOp`, borsh-encoded and hex.
     *
     * Signed by the joiner's device key, which is what stops an admitter
     * substituting a different member: peers check the op's signer against the
     * credential the op carries.
     */
    readonly signedOp: string;
}
/** What the admitter did with it. */
export interface AdmitJoinResponseData {
    /**
     * Whether the op reached the namespace topic.
     *
     * Not "joined" — membership lands when peers apply the op, which the admitter
     * neither performs nor waits for.
     */
    readonly published: boolean;
}
