/**
 * The second way to log in: sign in to Calimero Cloud instead of connecting to
 * a node.
 *
 * # Two connection shapes, one SDK
 *
 * `createMeroJs({ baseUrl })` is the node connection: point at a node, hold a
 * credential on it, and drive its admin API and JSON-RPC. It assumes the caller
 * has a node — their own, or one they have an account on.
 *
 * `connectCloud(...)` is for the caller who has neither. They sign in with the
 * identity they already use (Google, through the cloud), and the cloud answers
 * with an attested TEE relay serving their namespace. Writes then go through
 * delegated execution: signed here, run there, attributed here.
 *
 * The two are not alternatives to be picked at random — they answer different
 * questions. "Which node do I talk to?" has an answer for a desktop app and no
 * answer at all for a web app whose user has never installed anything. This
 * function is that missing answer, which is why the login step it replaces is
 * the *node URL prompt* rather than the authentication.
 *
 * `connectCloudWithAccount(...)` is the same connection reached by the other
 * door: the caller holds an account root and signs in as the account itself,
 * with no Google login anywhere in it. Identical from there on, deliberately —
 * which login proved who you are changes nothing about how a relay is found or
 * how a write is authorised.
 *
 * # What it does not do
 *
 * # Sealing the relay
 *
 * TLS in front of a relay ends outside its TD, at the host's ingress, where
 * the warrant and the method's arguments are readable. Pass `seal` (a quote
 * verifier) and every call to the relay is sealed to the key its attested TD
 * holds, so they are readable only inside it.
 *
 * It does not read state. A relay writes on the author's behalf; reads still
 * come from a node the client can query, or from the app's own projection of
 * the events it receives. `connectCloud` is deliberately narrow about this
 * rather than presenting a half-working `MeroJs` whose `admin` and `rpc` would
 * need a credential nobody holds.
 */
import { CloudClient } from './cloud-client.js';
import type { CloudClientConfig, CloudNamespace, CloudRelay } from './cloud-client.js';
import { RelayClient } from '../relay/relay-client.js';
import type { IntentResult, NonceSource } from '../relay/index.js';
import { type Signer } from '../signer/signer.js';
import { type RootSource } from '../account/account.js';
import { MeroClient } from '../transport/mero-client.js';
import type { Audience } from '../login/index.js';
import type { VerifyTransportQuote } from '../sealed/sealed.js';
export interface ConnectCloudOptions {
    /** Defaults to the hosted cloud. */
    cloudBaseUrl?: string;
    /** A stored MDMA session token. Provide this or `googleIdToken`. */
    sessionToken?: string;
    /** A Google ID token to exchange for a session. Provide this or `sessionToken`. */
    googleIdToken?: string;
    /** Persist a new or rolling-refreshed session. See {@link CloudClientConfig.onSession}. */
    onSession?: CloudClientConfig['onSession'];
    /** The author's account, hex — whose writes these will be. */
    authorAccount: string;
    /** The author's `AccountProof<DeviceCert>`, hex-encoded borsh. */
    authorProof: string;
    /**
     * The author device's ed25519 signing secret, hex. Never transmitted.
     *
     * Mutually exclusive with {@link ConnectCloudOptions.signer}, and the weaker
     * of the two in a browser — a secret that exists as a string can be read by
     * anything on the origin.
     */
    deviceSecret?: string;
    /**
     * The author device's signer — use instead of
     * {@link ConnectCloudOptions.deviceSecret}.
     *
     * A browser wallet holds its device key as a non-extractable `CryptoKey`,
     * which has no hex form to pass. Without this, that wallet — the case this
     * whole path was built for — had to hand-assemble the `RelayClient` the
     * one-call path exists to build.
     */
    signer?: Signer;
    /**
     * Which namespace to write in.
     *
     * Optional only when the user owns exactly one: guessing among several would
     * pick a tenant for them, and the failure would be a write landing in the
     * wrong place rather than an error.
     */
    namespaceId?: string;
    /**
     * Where nonces come from.
     *
     * Defaults to `localStorage`, keyed by the author's device public key, so a
     * reload continues the sequence instead of replaying it. Pass
     * {@link createMemoryNonceSource} explicitly for a process that owns its
     * whole sequence, or your own source to coordinate across tabs.
     */
    nonces?: NonceSource;
    /** Seconds a minted warrant stays presentable. Defaults to 300. */
    ttlSeconds?: number;
    /**
     * Seal every call to the relay to its attested TEE, verified with this — for
     * example {@link createQuoteVerifier} with the MRTDs you trust. The warrant
     * and the method's arguments then reach only the relay's TD, not whatever
     * terminates TLS in front of it, and the relay is one this client checked
     * itself rather than one the cloud vouched for. Calls to the cloud are not
     * sealed; they carry no intent.
     *
     * Without it, calls to the relay are plain HTTPS.
     */
    seal?: VerifyTransportQuote;
    fetch?: typeof fetch;
    timeoutMs?: number;
    /**
     * The chosen relay node's device signing key, hex — if you know it.
     *
     * Supplying it makes `connection.client` able to *observe* as well as write:
     * a relay is an ordinary node, and a keyholder with an account proof can log
     * in to it and subscribe. The key has to come from somewhere the caller
     * already trusts, which today means out of band, because the cloud does not
     * publish it (mdma #312).
     *
     * Left unset, the key the cloud reported is used — `null` for now, which
     * means `connection.client.canSubscribe === false` and nothing is guessed.
     * When #312 lands, unchanged callers start observing.
     */
    relayNodeKey?: string;
    /**
     * The audience the observing session is bound to. Defaults to this runtime's
     * own origin (or `cli`). See {@link RelayObserveConfig.audience}.
     */
    observeAudience?: Audience;
}
/** A signed-in cloud session with a relay ready to write through. */
export interface CloudConnection {
    /** The cloud API, for namespaces, billing, HA and sign-out. */
    cloud: CloudClient;
    /** The relay chosen for this namespace. */
    relay: RelayClient;
    /** The namespace writes will land in. */
    namespaceId: string;
    namespace: CloudNamespace;
    /** What the cloud reported about the chosen relay. */
    relayInfo: CloudRelay;
    /** Run one method in one context, on the author's behalf. */
    execute<T = unknown>(contextId: string, method: string, argsJson?: unknown): Promise<IntentResult<T>>;
    /**
     * The same connection behind the transport-neutral surface.
     *
     * `client.rpc.execute({ contextId, method, argsJson })` is the call a
     * node-backed app already writes, so an app reaching the cloud this way keeps
     * every call site it has — signing in *is* the transport decision, and it
     * happens here, once. `relay` and `execute` above are unchanged and remain
     * the direct path for a caller that wants `IntentResult` in hand.
     *
     * Whether it can also *observe* depends on one input: the relay node's
     * device signing key. A relay is an ordinary node and serves `/sse` and
     * `/ws`, but a login statement must be signed against a key learned out of
     * band. Pass {@link ConnectCloudOptions.relayNodeKey} if you have it; the
     * cloud does not publish it yet (mdma #312), so by default
     * `client.canSubscribe === false` and `client.events` throws saying so.
     */
    client: MeroClient;
}
/**
 * Sign in to the cloud and return a connection that can write.
 *
 * Throws rather than returning a half-usable connection, and the message says
 * which step is missing — no namespace, several to choose between, HA not
 * enabled, or no relay that relays (only replicas, or relays waiting for a
 * grant). Every one of those is
 * something the user has to go and do, and a client that reports them alike
 * cannot tell them what.
 */
export declare function connectCloud(options: ConnectCloudOptions): Promise<CloudConnection>;
/** What {@link connectCloudWithAccount} needs on top of a root. */
export interface ConnectCloudWithAccountOptions extends Omit<ConnectCloudOptions, 'sessionToken' | 'googleIdToken' | 'authorAccount'> {
    /**
     * The account root — a 64-hex secret, or a `Signer` over a key that cannot be
     * exported. The whole credential: no Google login is involved.
     */
    root: RootSource;
    /**
     * Whose writes these are, hex. Defaults to the account the root derives,
     * which is the only account it can open a session as.
     *
     * Worth passing only when the device certificate was issued by a *different*
     * root than the one signing in — which core accepts and nothing here needs to
     * forbid, but which is rare enough that defaulting to the signing root is the
     * safer shape.
     */
    authorAccount?: string;
}
/**
 * The same connection, opened with an account root instead of a cloud session.
 *
 * The two sign-in paths end in the same place, and until now only one of them
 * ended in a usable client: a caller signing in with a root had to open the
 * session, read the relays and assemble a {@link RelayClient} by hand, which is
 * three chances to pair the wrong author with the wrong executor.
 *
 * It is one call rather than one function: the session is minted here and
 * everything after it is {@link connectCloud}, unchanged. Duplicating the
 * namespace choice and the three no-relay diagnostics would mean two copies of
 * the messages that tell a user what to go and do.
 *
 * The author defaults to the account the root derives. That is not a
 * convenience — passing an account the root does not own is the mistake this
 * shape removes, since the cloud would answer with that root's namespaces while
 * every warrant claimed somebody else's authorship.
 */
export declare function connectCloudWithAccount(options: ConnectCloudWithAccountOptions): Promise<CloudConnection>;
