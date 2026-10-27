/**
 * Write to a context through a relay, holding nothing but a signing key.
 *
 * # What this replaces
 *
 * `sdk.rpc.execute` asks a node to run a method *as itself*: it needs a node,
 * that node needs to be a member, and the caller needs a credential on it. For
 * a browser tab, a phone, or an agent, none of those three is available — the
 * runtime cannot compile WASM against materialized state, never received the
 * scope key that seals the deltas, and has no account on anybody's node.
 *
 * This client is the other path. The caller signs a warrant locally, the relay
 * runs the method as the *author's* principal, and the resulting delta is
 * attributed to the author's account and device — their replica slot, their
 * membership, their name in the app. The relay's key signs the envelope and
 * nothing else.
 *
 * # The three preconditions, and why they are checked in this order
 *
 * `describe()` answers the first two in one call, before anything is signed:
 * the relay's executor account and signing key and the release the context's
 * group names (which the warrant must name), and whether it holds
 * `CAN_AUTHOR_ON_BEHALF` on the owning group. The third,
 * that the author's account is a member, only the group knows, and it surfaces
 * as a refusal.
 *
 * Checking before signing is not politeness. A warrant consumes a nonce from a
 * monotonic per-device sequence, and one minted against the wrong executor is
 * unspendable: the number is gone and the write never happened.
 */
import { type Signer } from '../signer/signer.js';
import { type GovernanceOp } from '../warrant/governance-op.js';
import type { NonceSource } from './nonce-source.js';
/** Where and as whom to write, plus the key that consents. */
export interface RelayClientConfig {
    /**
     * The relay's base URL — the node's origin, not a path.
     *
     * Discover it from {@link CloudClient.getNamespaceRelays} for a hosted
     * namespace, or take it from the operator for a self-hosted one.
     */
    relayUrl: string;
    /**
     * The account the relay writes as, hex — a warrant's `executor`.
     *
     * Only checked against what the relay answers: a warrant also names the
     * relay's signing key and the release, which only discovery reports, so every write asks.
     */
    executorAccount?: string;
    /** The author's account, hex — whose consent the warrant carries. */
    authorAccount: string;
    /**
     * The author's `AccountProof<DeviceCert>`, hex-encoded borsh.
     *
     * Proves the key that signed the warrant is a device of the account it names.
     * The author sends only its own half; the relay attaches its own.
     */
    authorProof: string;
    /**
     * The author device's ed25519 signing secret, hex (32 bytes).
     *
     * Never transmitted. It signs in this process and only the signature leaves,
     * which is the whole reason a keyholder can author without a node.
     *
     * Mutually exclusive with {@link RelayClientConfig.signer}: exactly one is
     * required. A browser should prefer the signer: a secret held as a string is
     * readable by anything on the origin, and a non-extractable key is not.
     */
    deviceSecret?: string;
    /**
     * The author device's signer: use instead of
     * {@link RelayClientConfig.deviceSecret} when the key cannot be exported
     * (a non-extractable WebCrypto key, a passkey, a hardware or remote signer).
     */
    signer?: Signer;
    /**
     * Where nonces come from. See {@link NonceSource} — a reset replays.
     *
     * Persist it (`createLocalStorageNonceSource` in a browser): the node keeps
     * the spent ledger but serves no lookup of it, so the client's own counter is
     * the only record of where the sequence stands.
     */
    nonces: NonceSource;
    /**
     * Seconds a minted warrant stays valid. Defaults to 300.
     *
     * Checked by the relay against its own clock, and by peers against the
     * delta's own signed stamp, never their clocks: this bounds how long *this*
     * request may sit in flight before the relay runs it.
     */
    ttlSeconds?: number;
    /** Injected for tests and non-browser runtimes. Defaults to global `fetch`. */
    fetch?: typeof fetch;
    timeoutMs?: number;
    /**
     * How many times a `429` is waited out before it reaches the caller.
     * Defaults to 3; `0` surfaces rate limits immediately.
     *
     * Safe to retry because the relay's ingress limiter runs before the node sees
     * the request, so a throttled warrant's nonce is not spent.
     */
    rateLimitRetries?: number;
}
/** The relay a warrant names: its account, and the one key of it that may spend the warrant. */
export interface RelayExecutor {
    /** The account a warrant must name as `executor`, hex. */
    executorAccount: string;
    /** The signing key a warrant must name as `executor_key`, hex. */
    executorKey: string;
}
/** What a relay says about its ability to run intents in one context. */
export interface RelayDescription extends RelayExecutor {
    /** Whether the relay holds `CAN_AUTHOR_ON_BEHALF` on the owning group. */
    canAuthorOnBehalf: boolean;
    /** The group whose admin grants that capability, hex. */
    groupId: string;
    /**
     * The blob id of the release the group names, hex: what a warrant must pin
     * as `release_bytecode_id`. Discovery answers 404 while the group names none.
     */
    releaseBytecodeId: string;
    /** That release's semver, signed as the warrant's `release_version`. */
    releaseVersion: string;
}
/** What a relay says about its ability to create contexts in one group. */
export interface CreationDescription extends RelayExecutor {
    /** The group, hex. */
    groupId: string;
    /**
     * Whether the relay has standing to act for members of this group (a
     * `RelayTee` role or `CAN_AUTHOR_ON_BEHALF`). It needs no create rights of
     * its own — those are checked on the author.
     */
    canCreateOnBehalf: boolean;
    /**
     * Whether the author holds `CAN_CREATE_CONTEXT` (or admin) here. Present only
     * when `describeCreation` was given an `author`.
     */
    authorMayCreate?: boolean;
}
/** What {@link RelayClient.createContext} creates. */
export interface CreateContextInput {
    /** The group to create the context in, hex. */
    groupId: string;
    /** The application to create it with, hex (32 bytes). */
    applicationId: string;
    /** The JSON the app's `init()` receives — run as the author's account. */
    initArgs?: unknown;
    /** Which service of a multi-service bundle; absent for the default. */
    serviceName?: string;
    /** A display name for the context. */
    name?: string;
    /**
     * The seed the context id is derived from, hex (32 bytes). Random when
     * absent, which is what almost every caller wants.
     */
    seed?: string;
}
/** Where a delegated creation landed. */
export interface CreatedContext {
    /** The new context's id, hex. */
    contextId: string;
    /** The group it was created in, hex. */
    groupId: string;
    /** The relay's identity in the new context, hex. */
    memberPublicKey: string;
}
/** What a relay says about publishing governance ops for members of one group. */
export interface GovernanceDescription extends RelayExecutor {
    /** The group asked about, hex. */
    groupId: string;
    /**
     * Whether the relay may act for members here (a `RelayTee` role or
     * `CAN_AUTHOR_ON_BEHALF`). It needs no right to the op itself: that is
     * checked on the author, as the op is applied as the author.
     */
    canActOnBehalf: boolean;
}
/** What {@link RelayClient.govern} publishes. */
export interface GovernInput {
    /**
     * Where the op is published, hex: the group itself for a group op, the
     * **namespace** for a root op (creating, moving or deleting a subgroup).
     */
    groupId: string;
    /** The op, from one of the encoders (`memberAddedOp`, `groupCreatedOp`, ...). */
    op: GovernanceOp;
}
/** Where a delegated governance op landed. */
export interface GovernResult {
    /** The group the op acted on, hex: the new subgroup, for a creation. */
    groupId: string;
}
/** What {@link RelayClient.foundNamespace} founds with. */
export interface FoundNamespaceInput {
    /**
     * The salt the namespace id is derived from, hex (32 bytes). Random when
     * absent, which is what almost every caller wants: one account founds many
     * namespaces by varying it.
     */
    salt?: string;
    /**
     * The relay's account and node key (pinned, or from `resolveRelayNodeKey`). Never
     * a discovery answer: that key is unauthenticated, and no namespace exists yet.
     */
    executor: RelayExecutor;
    /**
     * The namespace root's default capability mask (`MemberCapabilities` bits),
     * set right after founding. A namespace is founded with core's minimal
     * default (`CAN_JOIN_OPEN_SUBGROUPS` only), so an app that wants members to
     * create contexts or invite, for example, names its own mask here.
     *
     * Set through the relay with a delegated `DefaultCapabilitiesSet`, applied as
     * the founder, who is the namespace's admin. It cannot include
     * `CAN_AUTHOR_ON_BEHALF` (bit 9): which relays may write for members is never
     * decided through a relay, and such a mask is refused before anything is
     * signed.
     */
    defaultCapabilities?: number;
    /**
     * The application the namespace runs, set right after founding. Without one
     * a founded namespace targets no application, and no context can be created
     * in it. Set through the relay with a delegated `TargetApplicationSet`, which
     * core accepts only as a group's first application.
     */
    application?: {
        applicationId: string;
        package: string;
        version: string;
    };
}
/** A namespace founded through a relay. */
export interface FoundedNamespace {
    /** The new namespace's id, hex: `foundedNamespaceId(author, salt)`. */
    namespaceId: string;
    /**
     * The salt it was derived with, hex. Keep it if anyone will need to be shown
     * who founded the namespace: `(founder, salt)` reproduces the id.
     */
    salt: string;
    /**
     * Whether the relay admitted itself as the namespace's first TEE, which also
     * sets its default relay-mode admission policy. `false` from a relay that is
     * not a TEE, or whose attestation failed (see `teeError`). The namespace is
     * founded either way.
     */
    teeEnabled: boolean;
    /** Why `teeEnabled` is `false`, when the relay tried and failed. */
    teeError?: string;
    /**
     * Present only when `defaultCapabilities` was asked for: whether the mask was
     * set. `false` leaves the namespace founded with core's default; retry with
     * `govern({ groupId: namespaceId, op: defaultCapabilitiesSetOp(mask) })`.
     */
    defaultCapabilitiesSet?: boolean;
    /** Why `defaultCapabilitiesSet` is `false`. */
    defaultCapabilitiesError?: string;
    /**
     * Present only when `application` was asked for: whether the namespace now
     * runs it. `false` leaves it with no application; retry with
     * `govern({ groupId: namespaceId, op: targetApplicationSetOp(application) })`.
     */
    applicationSet?: boolean;
    /** Why `applicationSet` is `false`. */
    applicationError?: string;
}
/** Where an accepted intent landed. */
export interface IntentResult<T = unknown> {
    /** The context's scope root after the run — did this change anything? */
    rootHash: string;
    /** The method's own return value. */
    returns: T | null;
}
/**
 * Thrown when a relay refuses an intent, carrying which precondition failed.
 *
 * The distinction is the whole reason this type exists. A `403` from this
 * endpoint means one of several unrelated things — no grant on the relay, the
 * relay is a TEE replica (`ReadOnlyTee`) or a `ReadOnly` member (neither ever
 * relays), the author is
 * not a member or is read-only in the context, or the nonce was already spent
 * — and they send a caller somewhere completely different: ask an admin, pick
 * a relay the namespace admits in `relay` mode, ask for an invitation, or just
 * retry. Collapsing them into "forbidden" makes a retryable replay look
 * like a permissions bug.
 */
export declare class IntentRefusedError extends Error {
    /** The relay's own explanation, verbatim. */
    readonly reason: string;
    /** `true` when re-presenting the same intent under a *fresh* warrant may work. */
    readonly retryable: boolean;
    readonly status: number;
    name: string;
    constructor(
    /** The relay's own explanation, verbatim. */
    reason: string, 
    /** `true` when re-presenting the same intent under a *fresh* warrant may work. */
    retryable: boolean, status: number);
}
export declare class RelayClient {
    private readonly baseUrl;
    private readonly config;
    private readonly fetchImpl;
    private readonly timeoutMs;
    /** How many times a 429 is waited out before it is raised. */
    private readonly rateLimitRetries;
    constructor(config: RelayClientConfig);
    /**
     * The relay's origin, trailing slash stripped.
     *
     * Exposed because a relay **is a node**: the same origin that answers the
     * intents routes also answers `/auth/challenge`, `/auth/token`, `/sse` and
     * `/ws`. Anything building an observing session over this relay needs the
     * URL, and asking the caller to pass it a second time is how the two drift.
     */
    get relayUrl(): string;
    /** The author's account, hex — whose consent every warrant here carries. */
    get authorAccount(): string;
    /**
     * The author's `AccountProof<DeviceCert>`, hex.
     *
     * The same credential `login()` wants, which is why it is readable: a caller
     * that already handed it to this client should not have to hand an identical
     * copy to the login as well, where the two could disagree.
     */
    get authorProof(): string;
    /**
     * The author device's signer.
     *
     * A {@link Signer} and never the secret: this returns something that can
     * *sign*, so no caller of a `RelayClient` gains the ability to read a key
     * that was passed in as `deviceSecret`. That asymmetry is the point — the
     * login needs a signature, not key material.
     */
    authorSigner(): Promise<Signer>;
    /**
     * Ask the relay what it can do in `contextId`.
     *
     * Cheap and unauthenticated on a relay that serves delegated execution
     * publicly, which is what makes it usable as a precondition check rather than
     * as diagnostics after a failure.
     */
    describe(contextId: string): Promise<RelayDescription>;
    /**
     * Mint a warrant for `method(args)` and present it to the relay.
     *
     * One intent, once: the warrant authorizes exactly this method and these
     * arguments in exactly this context, and its nonce is spent by the network on
     * apply. Nothing accumulates and nothing is reusable.
     */
    execute<T = unknown>(contextId: string, method: string, argsJson?: unknown): Promise<IntentResult<T>>;
    /**
     * Publish one presence statement through the relay (`presence-intents`).
     *
     * Not retried on 429: presence resends every 2.5 s anyway, and a retry would
     * only queue behind the next resend. A refusal throws with its `status`.
     */
    presenceIntent(contextId: string, body: {
        state: string | null;
        seq: number;
        sentAtMs: number;
        signature: string;
        authorProof: string;
    }): Promise<void>;
    /**
     * Ask the relay what it can do about creating contexts in `groupId`.
     *
     * Pass `author` (an account, hex) to also learn whether that account may
     * create here — `authorMayCreate` is present only then.
     */
    describeCreation(groupId: string, opts?: {
        author?: string;
    }): Promise<CreationDescription>;
    /**
     * Create a context in a group through the relay, as the author.
     *
     * Always asks {@link describeCreation} first — with the author, so both
     * standing checks happen before anything is signed. A relay without standing
     * in the group, or an author without `CAN_CREATE_CONTEXT`, is refused here as
     * an {@link IntentRefusedError} *before* a nonce is taken: the nonce source
     * is monotonic, and a warrant nobody will spend burns one for nothing.
     *
     * The creation warrant's nonce is spent in the new context's per-device
     * ledger — the same one later `execute` calls in that context draw from — so
     * it comes from the configured {@link NonceSource} like any other warrant.
     *
     * Sealing: nothing here is plaintext-specific. The request goes through the
     * injected `fetch`, so a `createAttestedSealedFetch` seals it exactly as it
     * seals `execute`. Whether the relay *accepts* it sealed is the node's call:
     * a proxy-auth relay only admits sealed requests for routes `merod` serves
     * without a credential, so `/admin-api/groups/:id/context-intents` must be on
     * that list on the core side or the request comes back
     * `403 sealed_route_unguarded`.
     */
    createContext(input: CreateContextInput): Promise<CreatedContext>;
    /**
     * Ask the relay whether it may publish governance ops for members of
     * `groupId`, and which account and key a warrant must name.
     */
    describeGovernance(groupId: string): Promise<GovernanceDescription>;
    /**
     * Publish one governance op through the relay, as the author.
     *
     * The warrant commits to the op's exact bytes and is scoped to `groupId`, so
     * the relay can neither change what the op does nor spend it elsewhere. Every
     * peer applies the op as the author, so the author's own rights decide
     * (`MANAGE_MEMBERS` to add a member, `CAN_CREATE_SUBGROUP` to create a
     * subgroup, and so on); a lack of them comes back as an
     * {@link IntentRefusedError} from the relay.
     *
     * Always asks {@link describeGovernance} first and refuses *before* taking a
     * nonce when the relay has no standing, for the reason `createContext` does.
     * The nonce comes from the configured {@link NonceSource}; it is spent in a
     * per-group ledger, and a monotonic source is correct for it as for every
     * other warrant.
     */
    govern(input: GovernInput): Promise<GovernResult>;
    /**
     * Found a namespace through the relay, with the author as its founder, owner
     * and admin. For an account with no node, this is how it gets a namespace at
     * all.
     *
     * The author signs the exact genesis (`NamespaceCreatedV2`, carrying the
     * author's own credential and the salt) under a root-plane governance
     * warrant scoped to the new namespace's id, which is derived from the
     * author's account and the salt, so the relay can neither choose another id
     * nor found it for anyone else. The relay takes an identity in the new
     * namespace, mints its key, publishes the genesis, and is seated as the
     * founding relay (a `Member` holding `CAN_AUTHOR_ON_BEHALF`), so later
     * `govern`, `createContext` and `execute` calls in the namespace work
     * through it straight away. A TEE relay then admits itself as the
     * namespace's first TEE; `teeEnabled` reports whether it did.
     *
     * The executor cannot be learned from the relay first: the namespace does not
     * exist, so `describeGovernance` has nothing to answer about. It comes from
     * `input.executor` only, and without it this throws before taking a nonce.
     * The nonce is spent in the new namespace's ledger.
     *
     * With `defaultCapabilities`, the founder then sets the namespace's default
     * capability mask through the same relay (a second warrant, a second nonce)
     * and `defaultCapabilitiesSet` reports whether it landed. A failure there
     * does not throw, since the namespace is already founded.
     *
     * Refusals (`400`/`403`) come back as {@link IntentRefusedError}; a salt
     * that names an existing namespace is a `409`, an `HTTPError`.
     */
    foundNamespace(input: FoundNamespaceInput): Promise<FoundedNamespace>;
    private postGovernance;
    /**
     * The relay's answer, checked against a configured account.
     * Decoded here so a relay naming no key is refused before a nonce is taken.
     */
    private checkedExecutor;
    /**
     * One request, waiting out a rate limit rather than failing the caller.
     *
     * The relay's ingress limits the delegated-execution routes to 20 requests a
     * second per source IP, burst 40 — tighter than everything else it serves,
     * because those two routes are the ones it answers to anonymous callers.
     *
     * Retrying a 429 is safe here in a way retrying most refusals is not: the
     * limiter sits *first* in the middleware chain, so a throttled request never
     * reached the node and its warrant nonce was never spent. The same bytes can
     * go again. Contrast the spent-nonce 403 below, which needs a fresh warrant.
     *
     * `Retry-After` is honoured when the ingress sends one; otherwise the wait
     * doubles from a little over the limiter's own window, which is the shortest
     * delay that can actually clear.
     */
    private json;
    private jsonOnce;
}
