import { HttpClient } from '../http-client/index.js';
import type { HealthStatus, ReadinessStatus, AdminAuthStatus, InstallApplicationRequest, InstallApplicationResponseData, InstallDevApplicationRequest, UninstallApplicationResponseData, ListApplicationsResponseData, GetApplicationResponseData, ApplicationVersionEntry, GetApplicationAbiResponseData, GetLatestVersionResponseData, ListPackagesResponseData, ListVersionsResponseData, CreateContextRequest, CreateContextResponseData, DeleteContextResponseData, GetContextsResponseData, Context, GenerateContextIdentityResponseData, GetContextIdentitiesResponseData, JoinContextResponseData, JoinSubgroupInheritanceResponseData, ContextGroupResponseData, ContextStorageResponseData, UpdateContextApplicationRequest, ResyncContextRequest, ResyncContextResponseData, ContextsWithExecutorsResponseData, UploadBlobRequest, UploadBlobResponseData, DeleteBlobResponseData, ListBlobsResponseData, GetBlobInfoResponseData, BlobReadOptions, CreateContextAliasRequest, CreateApplicationAliasRequest, CreateDeviceAliasRequest, CreateAliasResponseData, LookupAliasResponseData, DeleteAliasResponseData, ListAliasesResponseData, ListNamespacesResponseData, CreateNamespaceRequest, CreateNamespaceResponseData, DeleteNamespaceResponseData, CreateNamespaceInvitationRequest, CreateNamespaceInvitationResponseData, CreateRecursiveInvitationResponseData, JoinNamespaceRequest, JoinNamespaceResponseData, CreateGroupInNamespaceRequest, CreateGroupInNamespaceResponseData, SubgroupEntry, Namespace, NodeIdentity, AccountPairInitRequest, AccountPairInitResponseData, AccountPairCompleteRequest, AccountPairCompleteResponseData, AccountSignWithRootRequest, AccountSignWithRootResponseData, RelinkDeviceRequest, RelinkDeviceResponseData, RescopeDeviceRequest, RescopeDeviceResponseData, LabelDeviceRequest, LabelDeviceResponseData, AccountDeviceEntry, AccountApplicationEntry, RevokeAccountDeviceRequest, LinkAccountDeviceRequest, LinkAccountDeviceResponseData, RevokeAccountDeviceResponseData, MemberDevicesEntry, ListMemberDevicesOptions, GroupInfoResponseData, CreateGroupRequest, CreateGroupResponseData, DeleteGroupResponseData, ListGroupMembersResponseData, ListGroupContextsResponseData, AddGroupMembersRequest, RemoveGroupMembersRequest, UpdateMemberRoleRequest, MemberCapabilities, SetMemberCapabilitiesRequest, SetDefaultCapabilitiesRequest, SetMemberAutoFollowRequest, SetSubgroupVisibilityRequest, SetTeeAdmissionPolicyRequest, GetTeeAdmissionPolicyResponseData, SetTeeAuthoringPolicyRequest, TransferOwnershipRequest, ChangeNamespaceAdminRequest, OwnerDeleteGroupRequest, RootGuardedOpRequest, SetGroupMetadataRequest, SetMemberMetadataRequest, SetContextMetadataRequest, MetadataRecord, SyncGroupResponseData, ActivateGroupUpgradeRequest, ActivateGroupUpgradeResponseData, UpgradeGroupRequest, UpgradeGroupResponseData, GroupUpgradeStatusResponseData, MigrationStatus, NamespaceRevokedDevices, CascadeStatusEntry, RetryGroupUpgradeResponseData, ReparentGroupRequest, ReparentGroupResponseData, IssueOwnershipProofRequest, IssueNamespaceOwnershipProofRequest, IssueOwnershipProofResponseData, CreateGroupInvitationRequest, CreateGroupInvitationResponseData, CreateRecursiveGroupInvitationResponseData, JoinGroupRequest, JoinGroupResponseData, TeeInfoResponseData, TeeAttestRequest, TeeAttestResponseData, PerformIntentRequest, PerformIntentResponseData, IntentRelayInfo, QueryContextRequest, QueryContextResponseData, ListMemberDevicesResponseData, SealToAccountRequest, SealedEnvelope, AdmitJoinRequest, AdmitJoinResponseData, CreateAccessGrantRequest, AccessGrant, CreatedAccessGrant, RevokeAccessGrantResponseData, AccessGrantCallRequest, AccessGrantCallResponseData } from './admin-types.js';
import { type RedeemOutcome } from './redeem-invitation.js';
/**
 * Compare two version strings by SemVer 2.0 precedence, ascending: negative if
 * `a < b`, positive if `a > b`, `0` if equal. Build metadata (`+...`) is stripped
 * and ignored. The numeric `major.minor.patch` core is compared field-by-field
 * (numerically when both parse, so `1.10.0 > 1.9.0`; a missing field is `0`). A
 * version WITH a pre-release ranks below the same core without one, and
 * pre-release identifiers compare per spec: dot-separated, numeric identifiers
 * numerically, alphanumeric lexically by ASCII, numeric below alphanumeric, and a
 * shorter set of identifiers loses when all preceding fields are equal.
 */
export declare function compareSemver(a: string, b: string): number;
export declare class AdminApiClient {
    private httpClient;
    constructor(httpClient: HttpClient);
    healthCheck(): Promise<HealthStatus>;
    /**
     * Whether the node has finished starting and its store answers. Public, like
     * {@link healthCheck}; unlike it, a node that is up but not ready answers
     * `503`, which this surfaces as an `HTTPError` whose body names the stage.
     */
    readinessCheck(): Promise<ReadinessStatus>;
    isAuthed(): Promise<AdminAuthStatus>;
    /**
     * Install a published application by its `package@version` coordinates. The
     * node resolves and fetches them from its own configured `[registry]`, so no
     * URL is passed and none is accepted. A 502 means the node's source has
     * nothing published at those coordinates. This is the discrete "download"
     * step an Updates flow pairs with a subsequent `upgradeGroup`.
     */
    installApplication(request: InstallApplicationRequest): Promise<InstallApplicationResponseData>;
    /**
     * List a package's published versions from the registry, newest-first by
     * semver. Reads the registry's V2 bundle listing
     * (`GET {registry}/api/v2/bundles?package={package}`), taking each bundle's
     * `appVersion`. Registry-side data — distinct from the node's
     * installed-version list — and the source an Updates view compares against
     * the running `Context.applicationVersion` to detect "a new version exists".
     */
    getRegistryVersions(registryUrl: string, packageName: string): Promise<string[]>;
    installDevApplication(request: InstallDevApplicationRequest): Promise<InstallApplicationResponseData>;
    uninstallApplication(appId: string): Promise<UninstallApplicationResponseData>;
    listApplications(): Promise<ListApplicationsResponseData>;
    getApplication(appId: string): Promise<GetApplicationResponseData>;
    /**
     * Installed-blob inventory for an application — one entry per locally installed
     * version. This is the *installed* inventory (source for a "pick a version to
     * pin" UI); the registry equivalent is `listPackageVersions`.
     */
    listApplicationVersions(applicationId: string): Promise<ApplicationVersionEntry[]>;
    /**
     * The application's embedded `wasm-abi/1` manifest. Omit `serviceName` for
     * single-service apps; core 400s if the ABI is absent or the name is ambiguous.
     */
    getApplicationAbi(applicationId: string, serviceName?: string): Promise<GetApplicationAbiResponseData>;
    listPackages(): Promise<ListPackagesResponseData>;
    listPackageVersions(packageName: string): Promise<ListVersionsResponseData>;
    getLatestPackageVersion(packageName: string): Promise<GetLatestVersionResponseData>;
    createContext(request: CreateContextRequest): Promise<CreateContextResponseData>;
    deleteContext(contextId: string): Promise<DeleteContextResponseData>;
    getContexts(): Promise<GetContextsResponseData>;
    getContext(contextId: string): Promise<Context>;
    getContextsForApplication(applicationId: string): Promise<GetContextsResponseData>;
    generateContextIdentity(): Promise<GenerateContextIdentityResponseData>;
    getContextIdentities(contextId: string): Promise<GetContextIdentitiesResponseData>;
    getContextIdentitiesOwned(contextId: string): Promise<GetContextIdentitiesResponseData>;
    joinContext(contextId: string): Promise<JoinContextResponseData>;
    getContextGroup(contextId: string): Promise<ContextGroupResponseData>;
    getContextStorage(contextId: string): Promise<ContextStorageResponseData>;
    /** Sync one context, or every context when `contextId` is omitted. */
    syncContext(contextId?: string): Promise<void>;
    /**
     * Kick off a full state re-pull for a context (operator recovery for a
     * stranded context). `force` re-pulls even when the node does not flag the
     * context as stranded.
     */
    resyncContext(contextId: string, request?: ResyncContextRequest): Promise<ResyncContextResponseData>;
    updateContextApplication(contextId: string, request: UpdateContextApplicationRequest): Promise<void>;
    getContextsWithExecutorsForApplication(applicationId: string): Promise<ContextsWithExecutorsResponseData>;
    uploadBlob(request: UploadBlobRequest): Promise<UploadBlobResponseData>;
    deleteBlob(blobId: string): Promise<DeleteBlobResponseData>;
    listBlobs(): Promise<ListBlobsResponseData>;
    /**
     * Blob-read query params. `context_id` is the same snake_case param
     * {@link uploadBlob} announces with; building it in one place keeps the read
     * side from drifting from the write side.
     */
    private blobPath;
    /**
     * Download a blob's raw bytes. `GET /admin-api/blobs/:id` streams the blob
     * content (e.g. `application/gzip`), NOT JSON — so fetch it as an ArrayBuffer.
     * Use {@link listBlobs} for `{ blobId, size }` metadata.
     *
     * Without `contextId` the read is local-only: the node answers from its own
     * blob store and returns immediately, or 404s. Passing `contextId` opts into
     * network discovery — the node probes that context's peers (availability
     * nodes first) for a holder, then transfers the bytes. Budget for it: core
     * bounds discovery by a ~30s deadline, and the transfer is on top of that, so
     * the worst case is well past what a UI should block on unhinted.
     */
    getBlob(blobId: string, options?: BlobReadOptions): Promise<ArrayBuffer>;
    /**
     * Fetch a blob's metadata without downloading it. `HEAD /admin-api/blobs/:id`
     * returns the info in response headers (size via `content-length`, plus
     * `x-blob-id`/`x-blob-hash`/`x-blob-mime-type`).
     *
     * Without `contextId` this is a local-only presence check that returns
     * immediately. Passing `contextId` opts into the same network discovery
     * {@link getBlob} uses — presence and size answered by probing the context's
     * peers, with no transfer — so it inherits core's ~30s discovery deadline as
     * its worst case. A probe only carries `found` and `size`, so a peer-sourced
     * answer has no `hash`/`mimeType`; read `source` to tell the two apart.
     */
    getBlobInfo(blobId: string, options?: BlobReadOptions): Promise<GetBlobInfoResponseData>;
    createContextAlias(request: CreateContextAliasRequest): Promise<CreateAliasResponseData>;
    createApplicationAlias(request: CreateApplicationAliasRequest): Promise<CreateAliasResponseData>;
    lookupContextAlias(name: string): Promise<LookupAliasResponseData>;
    lookupApplicationAlias(name: string): Promise<LookupAliasResponseData>;
    deleteContextAlias(name: string): Promise<DeleteAliasResponseData>;
    deleteApplicationAlias(name: string): Promise<DeleteAliasResponseData>;
    listContextAliases(): Promise<ListAliasesResponseData>;
    listApplicationAliases(): Promise<ListAliasesResponseData>;
    createDeviceAlias(request: CreateDeviceAliasRequest): Promise<CreateAliasResponseData>;
    lookupDeviceAlias(name: string): Promise<LookupAliasResponseData>;
    deleteDeviceAlias(name: string): Promise<DeleteAliasResponseData>;
    listDeviceAliases(): Promise<ListAliasesResponseData>;
    listNamespaces(): Promise<ListNamespacesResponseData>;
    getNamespace(namespaceId: string): Promise<Namespace>;
    /**
     * Who this node is — the account it writes as, the device it is, the key it
     * signs with, and the account root a second device pairs against.
     *
     * Takes no namespace, and that is the point: one root key is one account
     * everywhere, and a node signs with one key, so none of it varies by
     * namespace.
     */
    getNodeIdentity(): Promise<NodeIdentity>;
    /**
     * Ask this node to run one method on a member's behalf, under a warrant that
     * member signed.
     *
     * The node executes and signs the envelope with its own key; the change is
     * attributed to the **author**. Both halves travel together, so every peer
     * re-checks that the member consented instead of trusting the relay.
     *
     * Three things have to be true first, and none is implied by the others:
     *
     * - the author's **account** is a member of the group owning the context —
     *   their device joins nothing and is in no group's binding rows, which is
     *   exactly the case a device certificate covers;
     * - this node holds `CAN_AUTHOR_ON_BEHALF` on that group, which is implied by
     *   neither membership nor admin;
     * - the warrant has not been spent. It is single-use: presenting a valid one
     *   twice is refused, because the signature stays valid forever and replay is
     *   not forgery.
     *
     * A refusal comes back as a `403` carrying the reason — "an admin must grant
     * CAN_AUTHOR_ON_BEHALF to …", or that the nonce is already spent — so a caller
     * can tell which precondition failed rather than only that one did.
     *
     * Mint the warrant with {@link signWarrant}; see
     * {@link PerformIntentRequest.warrant}.
     */
    performIntent(contextId: string, request: PerformIntentRequest): Promise<PerformIntentResponseData>;
    /**
     * Read a context as the session's ACCOUNT, without minting a warrant.
     *
     * Needs an account-authenticated session — one from {@link login}, not the
     * admin password login — and refuses otherwise with a `401`. The account must
     * be a member of the group owning the context (`403` if not), and the method
     * must be declared read-only in the app's ABI (`409` if not; a write needs
     * {@link performIntent}).
     */
    queryContext(contextId: string, request: QueryContextRequest): Promise<QueryContextResponseData>;
    /**
     * Issue an access grant: a token whose holder may call `request.methods` in
     * `contextId`, as this node, with no session of its own.
     *
     * A grant only narrows: each method must be one this session's own token may
     * execute in the context (`403` otherwise), and an account session is refused
     * (`403`), since a granted call runs as the node. The token is in the answer
     * once and never again; the node keeps only its hash.
     */
    createAccessGrant(contextId: string, request: CreateAccessGrantRequest): Promise<CreatedAccessGrant>;
    /** The access grants of `contextId` this session could have issued. */
    listAccessGrants(contextId: string): Promise<AccessGrant[]>;
    /** Revoke an access grant. A grant this session cannot see is a `404`. */
    revokeAccessGrant(contextId: string, grantId: string): Promise<RevokeAccessGrantResponseData>;
    /**
     * Call one method under an access grant. The token is the whole credential:
     * the route is public on every node, so this works from a client holding no
     * session at all. A method the grant does not name, an unknown or revoked
     * token, and an expired grant are each a `403`.
     */
    callWithAccessGrant(contextId: string, request: AccessGrantCallRequest): Promise<AccessGrantCallResponseData>;
    /**
     * Ask what this node can do for a member in `contextId`, before they sign
     * anything.
     *
     * The facts {@link performIntent} needs and a client cannot derive: whose
     * account and key go in the warrant's `executor` and `executor_key`, which
     * release it pins, and whether this node holds `CAN_AUTHOR_ON_BEHALF` on the
     * owning group.
     * `canAuthorOnBehalf: false` comes back as an answer rather than an error, as
     * it is the default state of every context, so a caller can say "an admin of
     * `groupId` must grant it to `executorAccount`" instead of presenting a
     * warrant that will be refused after the author has spent a nonce on it.
     *
     * `404` means the context belongs to no group, this node holds no account or
     * identity in it yet, or its group names no release yet; no warrant can be
     * spent here until that changes.
     *
     * For a caller with no credential on the node at all — a browser tab holding
     * one signing key — use `RelayClient`, which reads this same route on a node
     * run as a relay.
     */
    getIntentRelay(contextId: string): Promise<IntentRelayInfo>;
    listNamespacesForApplication(applicationId: string): Promise<ListNamespacesResponseData>;
    createNamespace(request: CreateNamespaceRequest): Promise<CreateNamespaceResponseData>;
    deleteNamespace(namespaceId: string): Promise<DeleteNamespaceResponseData>;
    createNamespaceInvitation(namespaceId: string, request?: CreateNamespaceInvitationRequest): Promise<CreateNamespaceInvitationResponseData | CreateRecursiveInvitationResponseData>;
    /**
     * Present a join this caller signed to a node the inviter named as an
     * admitter.
     *
     * For a member with no node. `joinNamespace` publishes the membership op from
     * the node making the call; this hands an already-signed op to somebody else's
     * node to publish. The distinction matters because a keyholder has nowhere to
     * publish from.
     *
     * The op must be signed by the **device key** in the credential it carries —
     * every peer checks that when applying a join. So the admitter cannot author
     * this, only carry it: a hostile one can refuse, and nothing else. It cannot
     * admit a different account, change the group, or grant a role.
     *
     * @param namespaceId the namespace being joined, 64 hex
     * @param request the invitation and the hex-encoded signed op
     */
    admitJoin(namespaceId: string, request: AdmitJoinRequest): Promise<AdmitJoinResponseData>;
    joinNamespace(namespaceId: string, request: JoinNamespaceRequest): Promise<JoinNamespaceResponseData>;
    /**
     * Bring back a namespace the user removed from this node while the account
     * stayed a member (POST /admin-api/namespaces/:namespace_id/join, no
     * invitation). Such namespaces are the `forgotten` ones in
     * {@link listNamespacesForApplication}.
     */
    restoreNamespace(namespaceId: string): Promise<JoinNamespaceResponseData>;
    /**
     * Join the namespace an invitation grants, and say what happened — including
     * when the request failed but the join landed anyway.
     *
     * Use this rather than {@link joinNamespace} whenever someone is following an
     * invitation. A join waits for a member to come online and can outlast any
     * proxy in front of the node; the request then fails while the join
     * succeeds. This sends the join once, then checks {@link listNamespaces}:
     * a failed request whose namespace is listed is `already-member`, a success.
     *
     * Never throws for an ordinary failure. A failed outcome carries a `reason`
     * read off the node's status (core rc.56+), and `retryable`, which says
     * whether to keep the invitation for another attempt.
     *
     * @param namespaceId the namespace the invitation names, 64 hex
     * @param invitation the signed invitation, as the inviter's node minted it
     * @param options `groupName` is sent with the join; `teamName` is echoed back
     *   on a successful outcome for the caller's UI
     */
    redeemInvitation(namespaceId: string, invitation: JoinNamespaceRequest['invitation'], options?: {
        groupName?: string;
        teamName?: string;
    }): Promise<RedeemOutcome>;
    createGroupInNamespace(namespaceId: string, request?: CreateGroupInNamespaceRequest): Promise<CreateGroupInNamespaceResponseData>;
    listNamespaceGroups(namespaceId: string): Promise<SubgroupEntry[]>;
    /**
     * Mint this node a device for an account that already lives somewhere else -
     * the first half of pairing, run on the joining node.
     *
     * Publishes nothing and needs no key: it produces the device id, the two
     * public keys and the signature that the account holder's
     * {@link completeAccountPairing} certifies, plus a code to read out to them
     * over a channel the payload does not travel on. Until that second half runs,
     * the device this mints is inert.
     *
     * Takes a set of namespaces rather than one, and takes it from the caller
     * because this node cannot discover it: a node that is a member of nothing can
     * neither read the account's namespace set off a DAG nor derive it. One device
     * covers however many are named - the certificate is over the account, not a
     * scope - so there is one id and one code to hand over regardless.
     */
    initAccountPairing(request: AccountPairInitRequest): Promise<AccountPairInitResponseData>;
    /**
     * Certify a device another node minted, link it, and deliver its scope keys -
     * the second half of pairing, run on the node that holds the account root.
     *
     * Every field but `applications` is copied verbatim out of that node's
     * {@link initAccountPairing} answer. Only this side can complete it: the
     * certificate is signed by the account root, which never leaves the node that
     * holds it.
     *
     * The scope is named in applications, not namespaces, because that is the
     * question a person can answer - a namespace is an implementation unit they
     * never chose. Leave it out to grant every application.
     */
    completeAccountPairing(request: AccountPairCompleteRequest): Promise<AccountPairCompleteResponseData>;
    /**
     * Re-run the pairing fan-out for a device this account already certified,
     * against the namespaces this node takes part in now.
     *
     * Pairing is a snapshot, and this is how it is repeated. A namespace created
     * or joined afterwards holds no binding for a device paired before it, and the
     * symptom is silence - the device simply never sees that namespace. Nothing
     * but the id is needed to repair it: the certificate is already held here,
     * root-signed and naming no namespace, so a fresh endorsement and a key wrap
     * are all a later namespace is missing. The device does not have to be online.
     *
     * Passing `applications` widens the device's stored scope as well as
     * repairing. Passing none - or an empty list - repairs against the scope
     * already stored, which is deliberately NOT the "every application" that an
     * empty list means on {@link completeAccountPairing}: overloading it here
     * would make the accidental request the widest one.
     */
    relinkAccountDevice(deviceId: string, request?: RelinkDeviceRequest): Promise<RelinkDeviceResponseData>;
    /**
     * Replace a device's scope outright, in one root-signed op.
     *
     * {@link relinkAccountDevice} only ever adds applications; this is how a
     * scope is narrowed - or an `all` device is given a fixed list instead. The
     * device need not be online.
     */
    rescopeAccountDevice(deviceId: string, request: RescopeDeviceRequest): Promise<RescopeDeviceResponseData>;
    /**
     * Sign a payload an outside verifier specified, with this account's root.
     *
     * The counterpart to a verifier that issued a challenge and will check the
     * signature against the account id it derives — the cloud's account link and
     * login exchanges being the ones this exists for. The root never leaves the
     * node, so this is the only way a client can produce that signature.
     *
     * `domain` is a NAME from a closed set the node knows, never the domain bytes.
     * That is the security property rather than an encoding preference: signing
     * caller-supplied bytes under a caller-supplied prefix would be an oracle over
     * the one key that can certify a device. A node refuses a name it does not
     * know, and refuses one whose bytes could be extended into a credential of its
     * own.
     *
     * What comes back proves possession of the root and nothing else. Whether the
     * payload is a challenge anyone issued, whether it is fresh, and whether the
     * holder may link this account are the verifier's to decide — it issued the
     * challenge and knows who to.
     *
     * ```ts
     * const { nonce } = await cloud.getAccountLoginChallenge();
     * const { rootPublicKey, signature } = await admin.signWithAccountRoot({
     *   domain: 'mdma.account-login',
     *   payload: hexEncodeUtf8(nonce),
     * });
     * await cloud.submitAccountLogin({ rootPublicKey, nonce, signature });
     * ```
     */
    signWithAccountRoot(request: AccountSignWithRootRequest): Promise<AccountSignWithRootResponseData>;
    /**
     * Name a device of this account, for a listing to render.
     *
     * Run on the node holding the account root to name any device; a paired
     * node is accepted only for that device's own id.
     */
    labelAccountDevice(deviceId: string, request: LabelDeviceRequest): Promise<LabelDeviceResponseData>;
    /**
     * Every device of this account, as this node sees them - its own included.
     *
     * Joined from the node-local certificate cache and the live bindings of every
     * namespace this node takes part in, so it is this node's view rather than a
     * global one: a device certified by another holder appears with an empty
     * `applications`, because the certificate that would name its scope is not
     * cached here.
     *
     * The wire wraps this in `devices` rather than the usual `data`; the array is
     * what a caller wants, so that wrapper is not passed on.
     */
    listAccountDevices(): Promise<AccountDeviceEntry[]>;
    /**
     * Every application this account speaks in, with the namespaces targeting each.
     *
     * What a device-scoping UI lists: {@link completeAccountPairing} and
     * {@link relinkAccountDevice} both take applications, and this is where the
     * ids they take come from. Derived from the namespaces this node takes part
     * in, so an application installed with no namespace yet is absent - it has
     * nothing to scope a device to until one exists.
     *
     * Wrapped in `applications` on the wire rather than `data`, unwrapped here for
     * the same reason {@link listAccountDevices} unwraps `devices`.
     */
    listAccountApplications(): Promise<AccountApplicationEntry[]>;
    /**
     * Withdraw a device from this account, terminally.
     *
     * Two authorities reach the same endpoint. An admin may revoke any device and
     * rotates the scope key as it goes. The account holder may revoke its own with
     * a root-signed `proof`, which does not rotate - so read
     * {@link RevokeAccountDeviceResponseData.revokedIn} rather than assuming the
     * device lost its access: a namespace reporting `keyRotated: false` has
     * stopped the device writing but leaves it able to read until an admin
     * rotates.
     *
     * `namespaceId` names where to publish from, not the extent of the revocation:
     * a device belongs to the account, so every namespace holding a binding for it
     * is withdrawn from and reported back.
     *
     * **Revocation is forward-only.** It withdraws the device's authority from
     * here on and does NOT retract past authorship: ops the device already signed
     * keep verifying and stay in the DAG, because the certificate that authorised
     * them was valid when the signature was made. Nothing in this system can
     * un-author what a device wrote, so a UI built on this call must not offer
     * that - "this device can no longer act" is the only claim it supports.
     */
    revokeAccountDevice(namespaceId: string, request: RevokeAccountDeviceRequest): Promise<RevokeAccountDeviceResponseData>;
    /**
     * Carry the device link of an account **this node does not hold**, so the
     * namespace binds that device's key to the account.
     *
     * The relay half of a nodeless account minting invitations. An account added
     * to a group by account holds its grants but has no device bound, so peers
     * refuse whatever its device signs as "bound to no account". The credential
     * and scope are root-signed and self-certifying; this node adds its own
     * member endorsement and publishes the `AccountDeviceLinked`. After that the
     * device signs invitations itself — see `signGroupInvitation`.
     *
     * Refusals: `400` when a proof does not verify or the scope does not reach
     * this namespace (re-sign it), `403` when the device was revoked here or the
     * account is a member of nothing in the namespace (add it first).
     */
    linkAccountDevice(namespaceId: string, request: LinkAccountDeviceRequest): Promise<LinkAccountDeviceResponseData>;
    getGroupInfo(groupId: string): Promise<GroupInfoResponseData>;
    /** Thin wrapper over {@link getGroupInfo}: returns the group's `defaultCapabilities` bitmask. */
    getDefaultCapabilities(groupId: string): Promise<number>;
    /** Thin wrapper over {@link getGroupInfo}: returns the group's `subgroupVisibility`. */
    getSubgroupVisibility(groupId: string): Promise<string>;
    deleteGroup(groupId: string): Promise<DeleteGroupResponseData>;
    listGroupMembers(groupId: string): Promise<ListGroupMembersResponseData>;
    /**
     * Account -> devices for the members of a group, as its live bindings record
     * them.
     *
     * The join between a group member listing, which names accounts, and a
     * context's identities, which name bare signing keys - both 64 hex, and
     * nothing but the source tells them apart. Batch rather than per-account
     * because the key -> account direction gets asked about arbitrary authors,
     * which a per-account route would answer in N calls.
     *
     * What comes back is **caller-scoped by the node**: an admin of the group sees
     * every member's devices, a plain member only its own entry. A single-entry
     * answer is therefore a statement about this caller's role, not about the
     * group's size.
     *
     * Only live bindings appear, so a revoked device is absent here - use
     * {@link listAccountDevices} for the account's own devices, which keeps a
     * revoked one with `revoked: true`. Absence here never means the device never
     * acted: revocation is forward-only and its past ops remain in the DAG.
     *
     * Wrapped in `members` on the wire rather than `data`, unwrapped here for the
     * same reason {@link listAccountDevices} unwraps `devices`.
     */
    listGroupMemberDevices(groupId: string, options?: ListMemberDevicesOptions): Promise<MemberDevicesEntry[]>;
    /**
     * Member accounts in the group and the devices bound to each. An admin node
     * sees every account; a plain member only its own. `403` if this node is not a
     * member of the group.
     */
    listMemberDevices(groupId: string, options?: ListMemberDevicesOptions): Promise<ListMemberDevicesResponseData>;
    /**
     * Seal a small payload to a member account's root key. This node must be a
     * member of the group, and `account` must be an account the group knows, so
     * the route reaches no further than the caller already does.
     */
    sealToAccount(groupId: string, account: string, request: SealToAccountRequest): Promise<SealedEnvelope>;
    listGroupContexts(groupId: string): Promise<ListGroupContextsResponseData>;
    addGroupMembers(groupId: string, request: AddGroupMembersRequest): Promise<void>;
    removeGroupMembers(groupId: string, request: RemoveGroupMembersRequest): Promise<void>;
    /**
     * `identity` is the member's ACCOUNT (64 hex), as returned by
     * {@link listGroupMembers} — not the signing key that added them. Both are
     * 64 hex, so nothing but the source tells them apart.
     */
    updateMemberRole(groupId: string, identity: string, request: UpdateMemberRoleRequest): Promise<void>;
    /**
     * `identity` is the member's ACCOUNT (64 hex), as returned by
     * {@link listGroupMembers} — not the signing key that added them. Both are
     * 64 hex, so nothing but the source tells them apart.
     */
    getMemberCapabilities(groupId: string, identity: string): Promise<MemberCapabilities>;
    /**
     * `identity` is the member's ACCOUNT (64 hex), as returned by
     * {@link listGroupMembers} — not the signing key that added them. Both are
     * 64 hex, so nothing but the source tells them apart.
     */
    setMemberCapabilities(groupId: string, identity: string, request: SetMemberCapabilitiesRequest): Promise<void>;
    setDefaultCapabilities(groupId: string, request: SetDefaultCapabilitiesRequest): Promise<void>;
    /**
     * Make every member admitted to `groupId` from now on able to relay a
     * delegated write, without a per-node governance op each time.
     *
     * `CAN_AUTHOR_ON_BEHALF` is implied by nothing — not membership, not admin —
     * so every group is authorship-closed and each fleet relay otherwise needs an
     * admin to grant it individually, at the moment the relay is assigned and the
     * admin is not watching. Setting it in the group's DEFAULT mask is core's own
     * answer to that: `add_member` seeds a non-admin's capability row from the
     * default, so an attested node admitted afterwards lands open.
     *
     * Call it on the NAMESPACE (the root group). A grant resolves through the
     * membership anchor, so one at the root reaches every Open subgroup beneath
     * it, which is where contexts actually live; a `Restricted` subgroup is a
     * membership boundary and needs its own call.
     *
     * ### Two things this does not do
     *
     * **It is not retroactive.** The default is copied into a member's row when
     * that member is admitted, so nodes already admitted keep the row they got.
     * Use {@link grantAuthorship} for those — or call this at namespace creation,
     * which is the only point that needs no backfill at all.
     *
     * **It does not reach admins.** Core seeds the default only for non-admin
     * roles, and `CAN_AUTHOR_ON_BEHALF` is deliberately not implied by admin. An
     * admin's own node therefore stays closed and needs {@link grantAuthorship}.
     *
     * ### What it widens
     *
     * Every future non-admin member of the group, not only attested TEE nodes, so
     * any of them may be named as a warrant's `executor`. The bound worth knowing
     * before deciding: an executor cannot FORGE. A delegated write is authorized
     * by the author's own warrant — signed by their device key, committed to one
     * context, method and exact arguments, with its nonce checked unspent — so a
     * holder can only spend a warrant it was deliberately handed. What it does
     * gain is the arguments in cleartext and the choice of when, or whether, to
     * publish.
     *
     * Read-modify-write rather than a blind set: core seeds a new group's default
     * with `CAN_JOIN_OPEN_SUBGROUPS`, and overwriting that would quietly stop
     * every later member inheriting into Open subgroups.
     *
     * Returns the resulting mask and whether an op was published — it is a no-op
     * when the bit is already set, so it is safe to call on every startup.
     */
    openToDelegatedExecution(groupId: string): Promise<{
        changed: boolean;
        defaultCapabilities: number;
    }>;
    /**
     * Grant `account` the authorship bit on `groupId`, leaving its other
     * capabilities alone.
     *
     * The per-member counterpart to {@link openToDelegatedExecution}, and what
     * closes the gap that method cannot: a relay admitted BEFORE the default was
     * set, and an admin's own node, which never receives the default at all.
     *
     * `account` is the member's ACCOUNT id (64 hex) as `listGroupMembers` returns
     * it — for a fleet relay, the `account` the cloud reports for that node. Not
     * the signing key that added them; both are 64 hex, so nothing but the source
     * tells them apart.
     *
     * Read-modify-write, so it adds the bit rather than replacing the member's
     * mask. A no-op when the member already holds it.
     */
    grantAuthorship(groupId: string, account: string): Promise<{
        changed: boolean;
        capabilities: number;
    }>;
    setSubgroupVisibility(groupId: string, request: SetSubgroupVisibilityRequest): Promise<void>;
    setTeeAdmissionPolicy(groupId: string, request: SetTeeAdmissionPolicyRequest): Promise<void>;
    getTeeAdmissionPolicy(groupId: string): Promise<GetTeeAdmissionPolicyResponseData>;
    /**
     * Sets which admitted TEEs may author as the TEE authority. Pass
     * `{ allowedMrtd: [] }` to turn TEE authorship off. `groupId` must be a
     * namespace root; the node refuses a subgroup. The node exposes no read-back
     * route for this policy.
     */
    setTeeAuthoringPolicy(groupId: string, request: SetTeeAuthoringPolicyRequest): Promise<void>;
    /**
     * Turns TEE authorship off in the namespace: every TEE loses its authority,
     * and admitted TEEs stay members. The node applies the same op as
     * `setTeeAuthoringPolicy(groupId, { allowedMrtd: [] })`. `groupId` must be a
     * namespace root.
     *
     * `rootProof` is the signing admin's own root proof for that empty policy
     * (`teeAuthoringPolicyOp([])`); omit it on a node that holds that root.
     */
    disableTeeAuthoringPolicy(groupId: string, options?: RootGuardedOpRequest): Promise<void>;
    /**
     * Hand the group to `newOwner`, who must already be one of its admins.
     * Owner-only, and it needs the owner account's root proof; see
     * {@link RootGuardedOpRequest}.
     */
    transferOwnership(groupId: string, request: TransferOwnershipRequest): Promise<void>;
    /**
     * Repoint the namespace's admin pin at `newAdmin`, a member of its root.
     * Owner-only, with the owner account's root proof; see {@link RootGuardedOpRequest}.
     */
    changeNamespaceAdmin(namespaceId: string, request: ChangeNamespaceAdminRequest): Promise<void>;
    /**
     * Delete a group through the owner-only path: it must hold no contexts, and
     * the op needs the owner account's root proof. {@link deleteGroup} is the
     * admin-level cascading delete.
     */
    ownerDeleteGroup(groupId: string, request?: OwnerDeleteGroupRequest): Promise<void>;
    setGroupMetadata(groupId: string, request: SetGroupMetadataRequest): Promise<void>;
    getGroupMetadata(groupId: string): Promise<MetadataRecord | null>;
    setMemberMetadata(groupId: string, identity: string, request: SetMemberMetadataRequest): Promise<void>;
    /**
     * `identity` is the member's ACCOUNT (64 hex), as returned by
     * {@link listGroupMembers} — not the signing key that added them. Both are
     * 64 hex, so nothing but the source tells them apart.
     */
    getMemberMetadata(groupId: string, identity: string): Promise<MetadataRecord | null>;
    setContextMetadata(groupId: string, contextId: string, request: SetContextMetadataRequest): Promise<void>;
    getContextMetadata(groupId: string, contextId: string): Promise<MetadataRecord | null>;
    syncGroup(groupId: string): Promise<SyncGroupResponseData>;
    upgradeGroup(groupId: string, request: UpgradeGroupRequest): Promise<UpgradeGroupResponseData>;
    getGroupUpgradeStatus(groupId: string): Promise<GroupUpgradeStatusResponseData>;
    /**
     * The operator-facing "have all peers migrated?" rollup for a namespace.
     * The handler serializes the payload directly, so there is no `{ data }`
     * envelope to unwrap here (unlike most admin reads).
     */
    getMigrationStatus(namespaceId: string): Promise<MigrationStatus>;
    /** Revoked devices and withdrawn slots of a namespace; 403 unless this node is a bound member. */
    listNamespaceRevokedDevices(namespaceId: string): Promise<NamespaceRevokedDevices>;
    /** Per-group cascade-migration snapshots for a namespace. */
    getCascadeStatus(namespaceId: string): Promise<CascadeStatusEntry[]>;
    /** Switch this node's contexts in a namespace onto its stored upgrade target; 409 if an `expected*` guard differs. */
    activateGroupUpgrade(namespaceId: string, request?: ActivateGroupUpgradeRequest): Promise<ActivateGroupUpgradeResponseData>;
    retryGroupUpgrade(groupId: string): Promise<RetryGroupUpgradeResponseData>;
    /** Move `childGroupId` under `request.newParentId`. */
    reparentGroup(childGroupId: string, request: ReparentGroupRequest): Promise<ReparentGroupResponseData>;
    listSubgroups(groupId: string): Promise<SubgroupEntry[]>;
    detachContextFromGroup(groupId: string, contextId: string): Promise<void>;
    createGroupInvitation(groupId: string, request?: CreateGroupInvitationRequest): Promise<CreateGroupInvitationResponseData | CreateRecursiveGroupInvitationResponseData>;
    joinGroup(request: JoinGroupRequest): Promise<JoinGroupResponseData>;
    joinSubgroupInheritance(groupId: string): Promise<JoinSubgroupInheritanceResponseData>;
    getTeeInfo(): Promise<TeeInfoResponseData>;
    teeAttest(request: TeeAttestRequest): Promise<TeeAttestResponseData>;
    getPeersCount(): Promise<{
        count: number;
    }>;
    /** Node network status (GET /admin-api/network/status). */
    getNetworkStatus(): Promise<unknown>;
    /** Node storage/usage stats (GET /admin-api/usage). */
    getUsage(): Promise<unknown>;
    /** Create a standalone group (POST /admin-api/groups). */
    createGroup(request: CreateGroupRequest): Promise<CreateGroupResponseData>;
    /** Leave a group (POST /admin-api/groups/:group_id/leave). */
    leaveGroup(groupId: string): Promise<void>;
    /** Leave a context (POST /admin-api/contexts/:context_id/leave). */
    leaveContext(contextId: string): Promise<void>;
    /**
     * Leave a namespace (POST /admin-api/namespaces/:namespace_id/leave).
     *
     * With `purge`, every device of the account also takes the namespace off its
     * disk. Core reads `purge` from the query string, so it is not in the body.
     */
    leaveNamespace(namespaceId: string, options?: {
        purge?: boolean;
    }): Promise<void>;
    /** Issue a group ownership proof (POST /admin-api/groups/:group_id/issue-ownership-proof). */
    issueOwnershipProof(groupId: string, request: IssueOwnershipProofRequest): Promise<IssueOwnershipProofResponseData>;
    /** Issue a namespace ownership proof (POST /admin-api/groups/:group_id/issue-namespace-ownership-proof). */
    issueNamespaceOwnershipProof(groupId: string, request: IssueNamespaceOwnershipProofRequest): Promise<IssueOwnershipProofResponseData>;
    /**
     * Set a member's auto-follow flag (PUT
     * /admin-api/groups/:group_id/members/:identity/auto-follow).
     *
     * `identity` is the member's ACCOUNT (64 hex), as returned by
     * {@link listGroupMembers} — not the signing key that added them. Both are
     * 64 hex, so nothing but the source tells them apart.
     */
    setMemberAutoFollow(groupId: string, identity: string, request: SetMemberAutoFollowRequest): Promise<void>;
    /** Abort a namespace migration (POST /admin-api/groups/:namespace_id/migration/abort). */
    abortMigration(namespaceId: string): Promise<unknown>;
}
