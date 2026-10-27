/**
 * Calimero Cloud (MDMA) client.
 *
 * # Why the SDK knows about the cloud at all
 *
 * Delegated execution lets an account that holds one signing key write into a
 * context without running a node — but only through a *relay*, and a relay is
 * something the client has to be told about. A warrant names an executor
 * account, so a client that cannot discover which relay serves its namespace,
 * and which account that relay writes as, cannot mint a usable warrant at all.
 *
 * For a self-hosted namespace the operator hands those two facts over out of
 * band. For the hosted tier the cloud is the directory: the user signs in, the
 * cloud knows which namespaces they own and which attested TEE nodes are
 * assigned to each, and it answers with the relay's URL and executor account.
 * That is what this client is for — it is the discovery half of
 * {@link RelayClient}, not a second way to talk to a node.
 *
 * # What it deliberately is not
 *
 * It never sees a warrant, a device secret, or an intent. Discovery goes
 * through the cloud; the write goes straight from the client to the relay. A
 * cloud that proxied intents would read every method and argument its users
 * ever sent, and would be a throughput bottleneck on a path that has no reason
 * to involve it.
 */
import { type AccountOwnershipProof } from './account-ownership.js';
import { type RootSource } from '../account/index.js';
import { HTTPError } from '../http-client/web-client.js';
import type { Signer } from '../signer/signer.js';
import { type DiscoveryChallenge, type RoutingChallenge, type RoutingCredential } from './routing-proof.js';
/**
 * The first relay a warrant can be spent at, or `null`.
 *
 * Shared by {@link CloudClient.findExecutingRelay} and `connectCloud`, which
 * already holds the list and must not fetch it twice.
 */
export declare function pickExecutingRelay(relays: readonly CloudRelay[]): CloudRelay | null;
export interface CloudClientConfig {
    cloudBaseUrl?: string;
    /**
     * An MDMA session token to start out authenticated with — from a previous
     * {@link CloudClient.signInWithGoogle}, persisted by the app.
     *
     * Sessions are 7-day JWTs with a rolling refresh, so a stored one is usually
     * still live and re-running the Google flow on every launch is avoidable.
     */
    sessionToken?: string;
    /**
     * Called whenever the session token changes — a sign-in, an explicit
     * refresh, or a rolling refresh the server performed mid-request. Persist it
     * here; errors thrown are swallowed so a storage failure cannot mask the
     * response the caller is waiting for.
     */
    onSession?: (session: CloudSession | null) => void | Promise<void>;
    /** Injected for tests and non-browser runtimes. Defaults to global `fetch`. */
    fetch?: typeof fetch;
    /** Per-request timeout. Defaults to 10s, as the node clients do. */
    timeoutMs?: number;
    /**
     * The device credential to prove an account with on the routing read.
     *
     * Nothing to do with {@link sessionToken}: a cloud session says who is signed
     * in, this says which account holds the key. A joiner has the second and
     * cannot have the first — see `routing-proof.ts` for why that is not an
     * oversight.
     *
     * Omitting it leaves {@link CloudClient.getNamespaceRouting} anonymous, which
     * the cloud still answers while `require_routing_proof` is off. Supply it and
     * the read is attributed; the cloud verifies a supplied proof either way, so
     * a wrong one surfaces immediately rather than on the day the flag flips.
     */
    routingCredential?: RoutingCredential;
}
/** Who is signed in, and until when. */
export interface CloudSession {
    sessionToken: string;
    /** Epoch **seconds**, as MDMA reports it — not milliseconds. */
    expiresAt: number;
    user: {
        email: string;
        name?: string;
        picture?: string;
    };
}
/** One namespace the signed-in user owns. */
export interface CloudNamespace {
    namespaceId: string;
    /** Always equal to `namespaceId`; MDMA keeps it for wire compatibility. */
    groupId: string;
    /** `'enabled' | 'disabled' | 'none'` — `'none'` means HA was never enabled. */
    haStatus: string;
    haEnabledAt?: string | null;
    contexts: string[];
    fleetReplicas?: {
        current?: number;
        limit?: number;
    } | unknown;
}
/**
 * One attested node the cloud has assigned to a namespace, described as a
 * relay.
 *
 * `canExecute` is the field that decides whether a write can happen, and it is
 * the cloud's own verdict rather than something to re-derive: a node that
 * reports a role relays only as a `RelayTee` (the namespace's TEE admission
 * policy set with `mode: 'relay'`), whatever its grant; a `ReadOnlyTee` is a
 * replica and never relays. Only a node too old to report a role is decided by
 * `authorshipReady` — the `CAN_AUTHOR_ON_BEHALF` grant, which is reported
 * rather than assumed because it is not the cloud's to give.
 */
export interface CloudRelay {
    peerId: string;
    /** Base URL to present intents to, or `null` when the cloud knows none yet. */
    relayUrl: string | null;
    /** The account a warrant for this relay must name as its `executor`, hex. */
    executorAccount: string | null;
    /**
     * The relay node's ed25519 **device signing key**, hex — or `null`, which is
     * what it is today.
     *
     * A relay is an ordinary node, so it can be logged in to and subscribed to;
     * the login statement has to be signed against this key, supplied separately
     * rather than read from the node being authenticated. The cloud does not
     * publish it yet (mdma #312), so this is `null` on every row and the hosted
     * path reports `canSubscribe === false`.
     *
     * It is parsed rather than omitted so the hosted path needs no API change
     * when the field lands: `connectCloud` already passes it through, and the
     * same call site starts observing. `peerId` is **not** a fallback — it is a
     * libp2p identity, a different key, and signing a statement about it would
     * authenticate nothing.
     *
     * Both plausible spellings are accepted because mdma #312 has not fixed one;
     * if it lands under a third name, this mapping is the single line to change.
     */
    nodeKey: string | null;
    /** `'assigned'` (admitted pending confirm) or `'active'`. */
    status: string;
    /** Whether this relay holds `CAN_AUTHOR_ON_BEHALF` on the namespace. */
    authorshipReady: boolean;
    /**
     * The core role the node reported for itself here — `'RelayTee'` or
     * `'ReadOnlyTee'` — or `null` for a sidecar too old to report one.
     */
    teeRole: string | null;
    /**
     * Whether an intent can be presented here now: a URL, an executor account, a
     * fresh heartbeat, and a node that relays by role (or, for one reporting no
     * role, holds the grant).
     *
     * The cloud's `can_execute`. Against an older cloud that does not send it,
     * derived from `authorshipReady` plus the URL and account, as before.
     */
    canExecute: boolean;
    lastSeenAt?: string | null;
    confirmedAt?: string | null;
    /**
     * How far along this relay's admission is, as the cloud judges it:
     * `'confirmed'` (in), `'pending'` (trying), `'refused'` (alive and turned
     * away), `'absent'` (stopped talking before getting in). `null` from a cloud
     * that predates the field. A string, not a closed union, so a verdict the
     * cloud adds later is passed through rather than dropped.
     */
    admission: string | null;
    /** The cloud's one-line explanation of `admission`, for a person; `null` when none. */
    admissionHint: string | null;
    /**
     * What the relay itself reported about its latest attempt to join, reasons
     * included — or `null` when it has reported nothing (an older fleet node or
     * cloud, or a relay assigned since its last report).
     */
    join: CloudRelayJoin | null;
}
/**
 * A fleet node's own account of its latest attempt to join a namespace.
 *
 * A refusal happens peer to peer, between the node and the namespace's
 * admitters, so this is the only place a client learns WHY a relay is stuck:
 * the node forwards what each admitter it asked directly answered.
 */
export interface CloudRelayJoin {
    /**
     * `'admitted'` (in, or an admitter said yes and the key is on its way),
     * `'refused'` (every admitter asked declined; see `refusals`), `'waiting'`
     * (nobody answered directly yet), or `'error'` (the attempt itself failed;
     * see `error`). Passed through as sent.
     */
    state: string;
    /** Consecutive attempts without admission, as the node counts them. */
    attempts: number;
    /**
     * Each directly-asked admitter that declined: its libp2p peer id and its
     * reason, verbatim. Text to show a person, never to parse — the most useful
     * one is "was removed from group … and cannot rejoin; an admin must re-add
     * them", which the namespace owner can fix by re-adding the node.
     */
    refusals: Array<{
        peer: string;
        reason: string;
    }>;
    /** Why the attempt itself failed, when `state` is `'error'`. */
    error: string | null;
    /** When the node reported this, ISO 8601 (UTC, no offset), or `null`. */
    reportedAt: string | null;
}
/**
 * One node serving a namespace, as a caller with no cloud account sees it.
 *
 * The public counterpart to {@link CloudRelay}: same fleet rows, but keyed on a
 * namespace id anyone holding an invitation already has, and answering both
 * things a keyholder needs from a node rather than one of them.
 */
/**
 * One relay that serves an account, as the bootstrap read reports it.
 *
 * `fresh` and a null `relayUrl` are reported rather than filtered, because
 * "your relay is down", "we have no address for it" and "you have no relay"
 * need different actions from a caller and an empty list erases the
 * distinction. A caller looking for somewhere to talk to wants
 * `fresh && relayUrl`; one diagnosing wants the rest.
 */
export interface CloudAccountRelay {
    peerId: string;
    relayUrl: string | null;
    fresh: boolean;
    /**
     * The relay's own account id: 64 lowercase hex, the executor a delegated
     * write through this relay names.
     *
     * Null when the server did not say (older servers omit it) or sent anything
     * that is not 64 lowercase hex — an executor that cannot be named is the
     * same as none, and a malformed one would only fail later, at the node.
     */
    executorAccount: string | null;
    /**
     * True when the cloud has just assigned this relay to an account that had
     * none (the assignment is sticky); false for relays the account already
     * used, and on older servers that omit the field.
     */
    assigned: boolean;
}
export interface CloudNamespaceNode {
    peerId: string;
    /**
     * The node's own account id, hex.
     *
     * Intersect this against the invitation's signed `admitters` list before
     * using the node. That list is a MINT-TIME SNAPSHOT, so a node assigned after
     * an invitation was created is live, healthy, listed here, and still refused
     * with 403 — the cloud cannot know which invitation you hold.
     */
    account: string | null;
    /** Base URL, or `null` when the cloud knows none yet. */
    relayUrl: string | null;
    /** Ready-made admission URL, so a caller never rebuilds the path. */
    admitUrl: string | null;
    /** `'assigned'` (admitted pending confirm) or `'active'`. */
    status: string;
    /** Whether the node's heartbeat for this namespace is recent. */
    fresh: boolean;
    /**
     * Whether a signed join can be presented here now.
     *
     * Deliberately independent of {@link CloudNamespaceNode.authorshipReady}:
     * relaying a join the joiner already signed is not authoring on anyone's
     * behalf, so a node with no grant admits perfectly well.
     */
    canAdmit: boolean;
    /** Whether the node holds `CAN_AUTHOR_ON_BEHALF` on the namespace root group. */
    authorshipReady: boolean;
    /** `'RelayTee'`, `'ReadOnlyTee'`, or `null` for a node too old to report one. */
    teeRole: string | null;
    /**
     * Whether a delegated write can be posted here now — a URL, an account, a
     * fresh heartbeat, and a `RelayTee` (or, for a node reporting no role, the
     * grant). A `ReadOnlyTee` is a replica and never relays.
     *
     * Namespace-level. A context in a RESTRICTED SUBGROUP is governed by that
     * subgroup, so per-context routing remains the exact answer if a write is
     * refused despite this being true.
     */
    canExecute: boolean;
}
/** What {@link CloudClient.getNamespaceRouting} reports. */
export interface CloudNamespaceRouting {
    namespaceId: string;
    /** Usable nodes first, then a stable order, so a polling caller sees no shuffle. */
    nodes: CloudNamespaceNode[];
    /** Whether any listed node can take a join now. */
    servable: boolean;
    /** Whether any listed node can take a delegated write now. */
    writable: boolean;
}
/** One namespace of the caller's that a machine is serving. */
export interface CloudMachineNamespace {
    namespaceId: string;
    /** `'assigned'` (admitted pending confirm) or `'active'`. */
    status: string;
    /** Whether the machine holds `CAN_AUTHOR_ON_BEHALF` on this namespace. */
    authorshipReady: boolean;
    /** `'RelayTee'`, `'ReadOnlyTee'`, or `null` for a machine too old to report one. */
    teeRole: string | null;
    /**
     * Whether the machine's heartbeat for this namespace is recent.
     *
     * The same freshness rule the per-plan fleet cap uses, so a replica that
     * stopped polling reads as stale here rather than continuing to look
     * healthy — otherwise "my writes stopped working" has no visible cause.
     */
    fresh: boolean;
    confirmedAt?: string | null;
    lastSeenAt?: string | null;
}
/**
 * One attested machine serving this account.
 *
 * A narrow view on purpose: the zone, machine type, instance name, public IP
 * and KMS ids are operator data with no client use, and a cloud user is not an
 * operator.
 */
export interface CloudMachine {
    peerId: string;
    relayUrl: string | null;
    executorAccount: string | null;
    /**
     * Whether this machine can write for the caller *somewhere* — a URL, an
     * executor account, and at least one namespace it relays in: as a
     * `RelayTee`, or, reporting no role, holding the grant.
     *
     * Folded here so a client does not re-derive the three-way precondition and
     * get a refusal it cannot explain.
     */
    canExecute: boolean;
    /** Only the caller's own namespaces, even on a machine shared with others. */
    namespaces: CloudMachineNamespace[];
}
/** A Calimero account linked to this cloud login. */
export interface CloudLinkedAccount {
    /** The account id, 64 hex. */
    accountId: string;
    linkedAt?: string | null;
    /**
     * Whether a recovery envelope has been stored for this account, so a UI can
     * say "recoverable" without fetching the blob.
     */
    hasRecoveryEnvelope: boolean;
}
/** What {@link CloudClient.getMyAccounts} reports. */
export interface CloudLinkedAccounts {
    accounts: CloudLinkedAccount[];
    /** How many the caller's plan allows. `null` means no limit. */
    limit: number | null;
}
/** A single-use challenge to sign with an account root. */
export interface AccountLinkChallenge {
    /** Sign this verbatim — it is an opaque sealed string, not a decodable id. */
    nonce: string;
    /** When it stops being accepted, epoch milliseconds. */
    expiresAtMs: number | null;
}
/** A proof assembled by whoever holds the root, for {@link CloudClient.submitAccountLink}. */
export interface AccountLinkProof {
    /** The account being claimed, 64 hex. */
    accountId: string;
    /** The root that names it, 64 hex. */
    rootPublicKey: string;
    /** The challenge that was signed. */
    nonce: string;
    /** `signAccountLink`'s output — standard base64. */
    signature: string;
}
/** Where to send someone so a cloud login can consent to linking an account. */
export interface AccountLinkHandoff {
    /** The cloud portal URL to open — a new tab, a popup, or the system browser. */
    url: string;
    /** The account the consent will be for, echoed so a caller can show it. */
    accountId: string;
}
/** What comes back on the callback: a grant, a refusal, or neither. */
export interface AccountLinkCallback {
    /** The grant to spend with {@link CloudClient.linkAccountWithGrant}. */
    grant?: string;
    /** The account the grant is for, as the portal echoed it. */
    accountId?: string;
    /** The cloud login that consented. Show it before spending: anyone holding the handoff URL could have answered it. */
    login?: string;
    /** This browser's secret for the grant. Pass it to {@link CloudClient.linkAccountWithGrant}. */
    verifier?: string;
    /** `'denied'` when the person cancelled, `'unexpected_callback'` for a grant this browser never asked for. */
    error?: string;
}
/** A single-use challenge for an account root to sign itself in with. */
export interface AccountLoginChallenge {
    /** Sign this verbatim. Opaque and sealed by the cloud; nonces live ~2 minutes. */
    nonce: string;
    /** When it stops being accepted, epoch milliseconds. */
    expiresAtMs: number;
}
/** A proof assembled by whoever holds the root, for {@link CloudClient.submitAccountLogin}. */
export interface AccountLoginProof {
    /**
     * The root that names the account, 64 hex.
     *
     * No `accountId` field, unlike {@link AccountLinkProof}: the cloud derives
     * the account from this key rather than accepting one alongside it, so there
     * is nothing a caller could state that the signature would then contradict.
     */
    rootPublicKey: string;
    /** The challenge that was signed. */
    nonce: string;
    /** `signAccountLogin`'s output — standard base64. */
    signature: string;
}
/** The outcome of {@link CloudClient.linkAccount}. */
export interface CloudAccountLink {
    accountId: string;
    linkedAt?: string | null;
    /**
     * True when this account was already linked to this same login, which the
     * cloud treats as a 200 no-op rather than an error. A caller re-running
     * onboarding gets success, not a confusing failure.
     */
    alreadyLinked: boolean;
}
export interface EnableHAOptions {
    groupId: string;
    contextId: string;
    redirectUrl?: string;
}
export interface DisableHAOptions {
    groupId: string;
    contextId: string;
    redirectUrl?: string;
}
/** Options for {@link CloudClient.enableHaAsAccount}. */
export interface EnableHaAsAccountOptions {
    /** The namespace, hex: the id `foundNamespace` returned. */
    namespaceId: string;
    /** The salt `foundNamespace` returned, hex (32 bytes). */
    salt: string;
    /** The founding account, hex. */
    accountId: string;
    /** The account's credential, hex `AccountProof<DeviceCert>`. */
    credential: string;
    /** The certified device's secret, hex. Give this or `signer`. */
    deviceSecret?: string;
    signer?: Signer;
    /** The claim's lifetime in ms; default one minute, at most five. */
    ttlMs?: number;
    /**
     * The relay that founded the namespace (the delegated session's `relayUrl`).
     * The cloud gives that relay to the fleet node as its admitter; without it
     * the node has to find the relay by discovery.
     */
    relayUrl?: string;
}
/**
 * The cloud's refusals of {@link CloudClient.enableHaAsAccount} that a
 * person can do something about. Both are `409`s with `{"error": code}`.
 *
 * Extends {@link HTTPError}, so `instanceof HTTPError` handling still catches it.
 */
export declare class AccountHaRefusedError extends HTTPError {
    /** The cloud's `error` code, verbatim. */
    readonly code: string;
    name: string;
    constructor(
    /** The cloud's `error` code, verbatim. */
    code: string, status: number, statusText: string, url: string, headers: Headers, bodyText?: string);
}
/**
 * `account_not_linked`: the account was never linked to a cloud user through
 * the wallet, so the cloud has nobody to host the namespace for. Linking it
 * fixes this; retrying does not.
 */
export declare class AccountNotLinkedError extends AccountHaRefusedError {
    name: string;
    static readonly CODE = "account_not_linked";
}
/**
 * `account_linked_to_several_users`: more than one cloud user linked this
 * account, so the cloud cannot tell whose quota hosts the namespace. Unlink it
 * from all but one.
 */
export declare class AccountLinkedToSeveralUsersError extends AccountHaRefusedError {
    name: string;
    static readonly CODE = "account_linked_to_several_users";
}
/**
 * `ha_request_pending` (409): another namespace of this account is waiting for
 * its first fleet node to be admitted. The route allows one at a time; it
 * clears once that node is admitted, or by disabling HA on it from a cloud
 * session. The claim was not spent.
 */
export declare class HaRequestPendingError extends AccountHaRefusedError {
    name: string;
    static readonly CODE = "ha_request_pending";
}
/**
 * `unknown_relay` (422): the cloud runs no relay at `relayUrl`. The claim was
 * not spent.
 */
export declare class UnknownRelayError extends AccountHaRefusedError {
    name: string;
    static readonly CODE = "unknown_relay";
}
/**
 * `relay_not_dialable` (422): the relay is the cloud's but has not reported
 * its addresses yet. The claim was not spent; retrying later can succeed.
 */
export declare class RelayNotDialableError extends AccountHaRefusedError {
    name: string;
    static readonly CODE = "relay_not_dialable";
}
export declare class CloudClient {
    private baseUrl;
    private session;
    private readonly onSession?;
    private readonly fetchImpl;
    private readonly timeoutMs;
    private readonly routingCredential?;
    constructor(config?: CloudClientConfig);
    /** The current session, or `null` when nobody is signed in. */
    getSession(): CloudSession | null;
    /** Whether a session token is held. Says nothing about the server agreeing. */
    isSignedIn(): boolean;
    /**
     * Exchange a Google OAuth2 ID token for an MDMA session.
     *
     * The app owns the Google flow (One Tap, an auth-code popup, a native
     * browser) and hands the resulting ID token here once. Everything after this
     * uses the returned session token, so the Google credential does not have to
     * be kept or re-minted per call.
     */
    signInWithGoogle(idToken: string): Promise<CloudSession>;
    /**
     * Sign in as a Calimero account, proving it with its root key.
     *
     * The password-free counterpart to {@link signInWithGoogle}: no Google, no
     * password, no server-held secret — the cloud mints a challenge, the account
     * root signs it, and the session that comes back is the same MDMA session
     * token every other cloud route already accepts.
     *
     * Doing this **once** is what makes an account's later device proofs mean
     * something. A routing read shows that the caller holds a device the root
     * certified, but certificates are public, so it can never show that anyone
     * held the root; the cloud records this claim and from then on knows the
     * account behind those reads was claimed by its owner. The claim is recorded
     * even when the session is refused.
     *
     * @param root the account root: its 64-hex secret, or a `Signer` over a root
     *   this process may use and cannot read — the form a phrase-held root in a
     *   browser takes. Either way nothing but a signature over the cloud's nonce
     *   travels.
     *
     * A `403` means either the signature did not verify, or the account is not
     * linked to a cloud login: ownership alone says who you are, and the link
     * says what you are entitled to. Anyone can mint a root offline, so a session
     * on the proof alone would authenticate perfectly and authorize nothing. The
     * ownership claim is recorded either way, so linking later needs no re-proof.
     */
    signInWithAccount(root: RootSource): Promise<CloudSession>;
    /**
     * Mint a challenge for an account root to sign.
     *
     * Public, and deliberately so: the caller has no session — obtaining one is
     * what this exchange does. The nonce is not a capability, it is the thing a
     * capability gets demonstrated against, and demonstrating it needs the root.
     *
     * Split out of {@link signInWithAccount} for the case that call cannot serve:
     * a root held by a hardware key, a desktop app or an air-gapped machine,
     * which signs without the secret ever reaching this process.
     */
    getAccountLoginChallenge(): Promise<AccountLoginChallenge>;
    /** Post a proof assembled elsewhere. The other half of {@link getAccountLoginChallenge}. */
    submitAccountLogin(proof: AccountLoginProof): Promise<CloudSession>;
    /**
     * Refresh the session token explicitly.
     *
     * Rarely needed: MDMA rolling-refreshes on ordinary authenticated calls and
     * this client adopts the replacement automatically. Use it when an app wants
     * a fresh token before going idle rather than on the next request.
     */
    refreshSession(): Promise<CloudSession>;
    /**
     * Revoke this session server-side and forget it locally.
     *
     * Local state is cleared even if the server call fails: the caller asked to
     * be signed out, and keeping a token they believe is gone is the worse of the
     * two failures.
     */
    signOut(): Promise<void>;
    /** Namespaces the signed-in user owns. */
    getMyNamespaces(): Promise<CloudNamespace[]>;
    /**
     * The relays serving one namespace: where to present an intent, and as whom.
     *
     * Everything a client needs in order to mint a warrant it can actually
     * spend. Filter on `canExecute` before signing — a warrant presented to a
     * relay that does not relay (a `ReadOnlyTee` replica, or a node with no role
     * and no grant) is refused *after* the author has burned a nonce from its
     * monotonic sequence on it.
     */
    getNamespaceRelays(namespaceId: string): Promise<CloudRelay[]>;
    /**
     * The first relay for `namespaceId` that can actually run an intent, or
     * `null`.
     *
     * "Can actually run one" is several conditions, and a client that checks
     * fewer gets a refusal it cannot explain: the cloud must know a URL, the
     * relay must have reported the executor account a warrant has to name, and
     * the node must relay — which the cloud folds into `canExecute`.
     */
    findExecutingRelay(namespaceId: string): Promise<CloudRelay | null>;
    /**
     * Where to reach a namespace without owning it: one read, both verbs.
     *
     * **Anonymous.** A joiner is by construction not the namespace owner and holds
     * no cloud session — needing one is exactly what this path exists to avoid.
     * Discovery is not authorization: merod refuses an `/admit` call unless the
     * relaying node's account is on the invitation's signed `admitters` list, and
     * refuses an intent unless the warrant is genuinely the member's, so naming a
     * node grants the caller nothing it did not already have.
     *
     * A keyholder resolves a namespace to a node ONCE and then admits, reads and
     * posts intents against that same node, which is why admission and writability
     * are answered together rather than across two endpoints — the per-context
     * read needs a context id a joiner does not yet have.
     *
     * An empty `nodes` list is a state, not an error: the cloud has no record of
     * a node holding the namespace, so there is no hosted admitter.
     */
    getNamespaceRouting(namespaceId: string): Promise<CloudNamespaceRouting>;
    /**
     * Ask the cloud for a challenge to prove an account against.
     *
     * Public and unauthenticated on purpose, and safe to be: the nonce is sealed
     * and bound to this one namespace, so it is not a capability — it is the
     * thing a capability gets demonstrated against. A caller with no credential
     * gains nothing by holding one.
     *
     * {@link getNamespaceRouting} calls this for you when the client was
     * constructed with a `routingCredential`. Call it directly only to sign a
     * challenge somewhere this client cannot reach the key.
     */
    getRoutingChallenge(namespaceId: string): Promise<RoutingChallenge>;
    /**
     * The proof headers for one routing read, or nothing when no credential was
     * configured.
     *
     * A challenge per read rather than a cached one: they expire in about two
     * minutes and are single-namespace, so caching would trade one cheap request
     * for a class of expiry bug that only shows up on a slow client.
     */
    private routingProof;
    /**
     * Ask the cloud for a challenge bound to one ACCOUNT.
     *
     * Public and unauthenticated like {@link getRoutingChallenge}: an account id
     * is `H(genesis(root_pk))` and travels in the clear in every device-link op,
     * so naming one here reveals nothing and authorises nothing. MDMA re-derives
     * the account from the certificate and refuses a mismatch.
     */
    getAccountRelaysChallenge(accountId: string): Promise<DiscoveryChallenge>;
    /**
     * Which relays serve this account — the bootstrap, and nothing more.
     *
     * A device holding a certificate can resolve a namespace it can *name*
     * ({@link getNamespaceRouting}) and can ask a node it can *reach* what its
     * account belongs to. It starts with neither. This closes that one gap.
     *
     * **It does not return namespaces, deliberately.** The node answers that from
     * the governance DAG, scoped to the calling account: log in at one of these
     * relays with an account proof and read its namespace listing. A cloud-side
     * copy would be a second source of truth built from rows that linger for an
     * account which left a namespace.
     *
     * So the sequence is: this → log in at a relay → ask it what you are in.
     *
     * Proven with the **device certificate**, not a cloud session, so it needs a
     * `routingCredential` and throws without one rather than returning an empty
     * list — "you configured no credential" and "you have no relays" are
     * different answers and must not look alike.
     */
    getAccountRelays(accountId: string): Promise<CloudAccountRelay[]>;
    /**
     * The node to send a signed join to, chosen from those an invitation names.
     *
     * Pass the invitation's `admitters` and the intersection is done here, because
     * skipping it is the failure this method exists to prevent: the cloud lists
     * every node assigned to the namespace, while `admitters` is a snapshot signed
     * when the invitation was minted. A node added afterwards looks perfect in
     * every field here and answers 403.
     *
     * Omit `admitters` only for an invitation that names none — an empty list on
     * the wire authorises any node to admit.
     */
    findAdmitter(namespaceId: string, admitters?: readonly string[]): Promise<CloudNamespaceNode | null>;
    /**
     * Every attested machine currently serving something this account owns.
     *
     * The account-wide view of the same rows {@link getNamespaceRelays} returns
     * per namespace, keyed by machine — so a UI can answer "what is running for
     * me?" in one call. `canExecute` folds the three-way precondition, so a
     * caller does not re-derive it.
     *
     * Only the caller's own namespaces appear on each machine. A plan's
     * `usersPerMachine` is greater than one, so a fleet node routinely serves
     * several accounts at once.
     */
    getMyMachines(): Promise<CloudMachine[]>;
    /**
     * Claim a namespace under this account, proving ownership.
     *
     * The cloud has no other way to learn a namespace exists — namespaces are
     * created on a node, and there is deliberately no "create namespace" in the
     * cloud. `ownershipProof` comes from
     * `admin.issueNamespaceOwnershipProof(namespaceId, …)` on a node that is a
     * **direct admin** of that namespace; merod refuses to issue one otherwise.
     *
     * Pass merod's response object straight through. The cloud accepts core's
     * `signerPublicKey`/`signedPayload` casing as well as snake_case, so there is
     * no re-keying step — and getting that wrong used to surface as a `422`
     * naming three missing fields. Passing it whole also carries the `founding`
     * and `credential` merod attaches: the cloud accepts a namespace proof only
     * from a node of the account that founded the namespace, checked with those
     * two, and only when that account is linked to this login. A node that
     * predates them, or an admin that did not found the namespace, gets a `422`.
     *
     * Idempotent for the same account. A namespace already claimed by someone
     * else is a `409`; a replayed proof nonce is a `403`.
     */
    claimNamespace(namespaceId: string, ownershipProof: unknown): Promise<void>;
    /**
     * Ask the fleet to host a claimed namespace — the step that gets a relay
     * assigned.
     *
     * Carries no proof: {@link claimNamespace} already established ownership,
     * and this is the separate "now host it" half. Idempotent.
     *
     * `admitterAddrs` is where the owner's own node can be dialed — take it from
     * that node's network status with {@link admitterAddrsFromNetworkStatus}.
     * The first fleet node placed on a namespace has nobody but the owner to ask
     * for admission, and without these it can only broadcast and hope the
     * owner's node — often a laptop behind a relay — hears it. They are a dial
     * hint, not a grant: the owner's node admits by its own policy. Omit them to
     * leave whatever the cloud already holds; pass them again when the node's
     * relay address changes, and they replace the stored ones.
     *
     * Not to be confused with {@link enableHA}, which opens the cloud's web flow
     * in a browser tab for a user to complete by hand. This is the API call.
     */
    enableNamespaceHa(namespaceId: string, options?: {
        admitterAddrs?: readonly string[];
    }): Promise<unknown>;
    /**
     * Enable HA for a namespace this ACCOUNT founded through a relay, with the
     * founder's claim (`signAccountOwnershipClaim`) instead of a node's
     * ownership proof: a nodeless account holds no node that could issue one.
     * The login must be linked to that account.
     */
    enableFoundedNamespaceHa(namespaceId: string, ownershipProof: AccountOwnershipProof): Promise<unknown>;
    /**
     * Enable HA for a namespace this account founded, with **no cloud session**.
     *
     * The anonymous sibling of {@link enableFoundedNamespaceHa}: it signs the
     * founder's claim itself ({@link signAccountHaClaim} — no `subject`, its own
     * audience) and posts it to
     * `/api/cloud/accounts/{accountId}/namespaces/{namespaceId}/enable-ha`. The
     * cloud bills the user the account is linked to through the wallet, so the
     * account must be linked to exactly one:
     *
     * - not linked at all → {@link AccountNotLinkedError};
     * - linked to several → {@link AccountLinkedToSeveralUsersError}.
     *
     * A claim that does not verify is a `403` `HTTPError`; quota and the rest
     * answer as the session route does. Returns the cloud's response body, the
     * same shape the session route's enable-ha returns.
     */
    enableHaAsAccount(options: EnableHaAsAccountOptions): Promise<unknown>;
    /**
     * Stop hosting a claimed namespace.
     *
     * The fleet's own reconcile loop does the rest: each assigned node notices
     * the namespace is no longer assigned to it and **self-leaves**, which makes
     * core evict it and purge its local data and keys. So this is not just a
     * billing flip.
     */
    disableNamespaceHa(namespaceId: string): Promise<unknown>;
    /**
     * The node assigned to the signed-in user, or `null`.
     *
     * @deprecated Use {@link getMyMachines}. This reads the cloud's retired
     * `NodeAssignment` ledger, which nothing has written since the v1
     * retirement, so it answers `null` for every namespace-native account —
     * which reads as "you have no machine" when the truth is "that is no longer
     * how a machine is assigned".
     */
    getMyNode(): Promise<Record<string, unknown> | null>;
    enableHA(options: EnableHAOptions): void;
    disableHA(options: DisableHAOptions): void;
    /** Record a freshly-issued session and tell the app to persist it. */
    /**
     * Link a Calimero account to this cloud login, proving possession of its root.
     *
     * Two hops, folded into one call because they are useless apart: fetch a
     * single-use challenge, then sign it with the account root and post the proof.
     * The secret never leaves this process — only a signature over a nonce the
     * cloud minted does.
     *
     * This is the binding the cloud bills against. A relay does not need it to run
     * an intent; the cloud needs it to know whose plan a hosted node is spending,
     * and to sign that account back in later.
     *
     * @param root the account root: its 64-hex secret — from
     *   {@link generateAccountRoot}, a restored recovery phrase, or a desktop app
     *   or hardware key that already holds one — or a `Signer` over a root this
     *   process cannot read, which is what a phrase-held browser root is.
     *
     * Idempotent for the same login. An account already linked to a *different*
     * cloud login is a `409`; a replayed or expired challenge is a `403`; and
     * exceeding the plan's account limit is a `402`.
     */
    linkAccount(root: RootSource): Promise<CloudAccountLink>;
    /**
     * Mint a single-use challenge for an account root to sign.
     *
     * The split half of {@link linkAccount}, for the case that call cannot serve:
     * a root held by a desktop app, a hardware key or an air-gapped machine, which
     * signs without the secret ever reaching this process. Fetch the challenge
     * here, have the holder sign it, then hand the proof to
     * {@link submitAccountLink}.
     *
     * Bound to the signed-in login and short-lived, so it is not a standing
     * capability if it leaks — but it IS single-use, so a challenge fetched and
     * abandoned is spent.
     */
    getAccountLinkChallenge(): Promise<AccountLinkChallenge>;
    /**
     * Post a proof assembled elsewhere. The other half of
     * {@link getAccountLinkChallenge}.
     *
     * `accountId` must be the account `rootPublicKey` names — the cloud refuses a
     * valid signature by a key that names a different account, or a caller could
     * prove one root and link somebody else's account. Derive both from the same
     * key rather than letting a user type either.
     */
    submitAccountLink(proof: AccountLinkProof): Promise<CloudAccountLink>;
    /**
     * Where to send someone to authorise linking this account, and what to expect
     * back. Pairs with {@link readAccountLinkCallback} and
     * {@link linkAccountWithGrant}.
     *
     * This exists because a browser app is in a bind: it holds an account root and
     * can never hold a *first* cloud session, since only Google issues one. So the
     * person goes to the cloud, where they are signed in, and consents there. What
     * comes back is a grant — consent to link this one account, spendable only by
     * whoever can sign with its root.
     *
     * @param callbackUrl where the portal sends the person back. Must be an origin
     *   the cloud allows; unlisted ones are refused when the grant is minted, not
     *   here. The grant arrives in the URL **fragment**, which browsers do not
     *   send to servers.
     *
     * Static, so it needs no client and no session: there is nothing to
     * authenticate as yet.
     */
    static accountLinkHandoff(options: {
        /** The cloud portal's origin, e.g. `https://cloud.calimero.network`. */
        portalUrl: string;
        /** The account to be linked, 64 hex — derive it, never let a user type it. */
        accountId: string;
        /** Where to come back to. */
        callbackUrl: string;
    }): Promise<AccountLinkHandoff>;
    /**
     * Read the portal's answer out of a callback URL's fragment.
     *
     * Returns `{}` when there is nothing to read, so it is safe to call on every
     * load — which is how a redirected app finds out it has been sent back.
     *
     * A grant is only returned when it answers a handoff this browser began, for the
     * account that handoff named; anything else comes back as
     * `error: 'unexpected_callback'`, because the redirect URL can be forwarded.
     *
     * @param href defaults to the current location, when there is one.
     */
    static readAccountLinkCallback(href?: string): AccountLinkCallback;
    /**
     * Spend a link grant: sign it with the account root and post the pair.
     *
     * Anonymous, and it has to be — the app doing this holds no cloud session,
     * which is the whole reason the grant exists. The grant carries the consenting
     * login sealed inside it, so nothing here names one; a caller-supplied email
     * would be a field to lie in.
     *
     * The signature is an ordinary account-link signature with the grant as the
     * nonce, so the same {@link signAccountLink} every other link path uses signs
     * this one. The grant is bound to the verifier of the browser that asked for
     * it, and is refused here, before the root signs, unless it carries that
     * verifier's challenge and names this root's account.
     *
     * A `403` means the grant was bad, expired, already spent, or signed by a key
     * that names a different account; `409` that the account belongs to another
     * login; `402` that the plan is full.
     */
    linkAccountWithGrant(options: {
        grant: string;
        /** The verifier {@link readAccountLinkCallback} returned with the grant. */
        verifier: string;
        /** The root of the account the grant names, 64 hex. */
        rootSecret?: string;
        /**
         * The root's signer — use instead of `rootSecret` when the root is a key
         * this process may use and cannot read.
         */
        signer?: Signer;
    }): Promise<CloudAccountLink>;
    /** The accounts linked to this login, and how many the plan allows. */
    getMyAccounts(): Promise<CloudLinkedAccounts>;
    private adoptSession;
    private notifySession;
    private request;
    /**
     * Adopt a session token the server refreshed mid-request.
     *
     * MDMA rotates the token on activity and returns the replacement in a
     * response header rather than making the client ask. Ignoring it costs
     * nothing immediately and then logs the user out a week later, which is the
     * kind of bug that is impossible to reproduce in a short session.
     *
     * The user identity is carried over: the header holds only a token, and the
     * refresh is the same logical session as the sign-in that named the user.
     */
    private adoptRollingRefresh;
}
/**
 * The addresses a fleet node can dial to ask this node for admission, from the
 * node's `GET /admin-api/network/status` (see `AdminApiClient`).
 *
 * Its `externalAddrs`, each made to end in `/p2p/<localPeerId>`: that is the
 * shape core dials, and an external address is usually reported without it. A
 * relay-circuit address already contains `/p2p/` — the relay's — so the test is
 * whether it ends in this node's own id, not whether it names a peer at all.
 * Anything that is not a multiaddr is dropped. Empty when the status names no
 * peer id or no external address, which is an honest "not dialable yet".
 */
export declare function admitterAddrsFromNetworkStatus(status: unknown): string[];
