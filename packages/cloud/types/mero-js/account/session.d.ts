import { type MeroClient } from '../transport/index.js';
/**
 * What a delegated connection needs to be rebuilt after a reload.
 *
 * `deviceSecret` is here because the device key is what signs warrants, and a
 * reload that could not sign would be a dead session. It is a per-tab secret for
 * a certificate the account can revoke — not the account root, which never
 * leaves the wallet's origin.
 */
/**
 * What the wallet certified: an account, a device it trusts, and the key that
 * device signs with. Everything except somewhere to send the result.
 *
 * Split out of {@link DelegatedSession} because it is reachable one step
 * earlier. An account that has just enrolled holds exactly this and no relay —
 * it is a member of nothing, so the cloud has no relay to name — and this is the
 * input that resolves one from an invitation instead.
 */
export interface DelegatedCredential {
    /** The author's account id, hex. */
    account: string;
    /** The author's `AccountProof<DeviceCert>`, hex borsh. */
    credential: string;
    /** The certified device's ed25519 signing secret, hex. */
    deviceSecret: string;
}
export interface DelegatedSession extends DelegatedCredential {
    /**
     * The relay to write through — a node origin, or `null` for none yet.
     *
     * **`null` is a logged-in state, not a broken one.** A brand-new account is a
     * member of nothing, so the cloud names no relay for it — and that is the
     * normal condition of an account that has just been created, because being
     * signed in is how you come to be invited in the first place. Refusing to
     * connect without a relay locked a new account out of the only path that
     * would earn it one.
     *
     * What it does NOT mean is that writes quietly do nothing. There is no
     * client at all without a URL ({@link buildDelegatedClient} returns `null`),
     * so `mero` stays `null`, the session is authenticated, and anything reaching
     * for `rpc.execute` is told the relay is missing. A placeholder URL would be
     * the one unacceptable answer: it would look connected and refuse every
     * warrant.
     */
    relayUrl: string | null;
    /**
     * The relay's executor account, hex, when the app knows it — the cloud's
     * machine page names it beside the relay's address.
     *
     * Founding a namespace through a relay names the relay's account (and its
     * node key) in the warrant, and a namespace that does not exist yet cannot be
     * asked for them.
     * Without this the account learns it from a namespace it is already in, so a
     * brand-new account would have to join one first; with it, the account founds
     * on `relayUrl` directly.
     */
    executorAccount?: string | null;
}
export declare function readDelegatedSession(): DelegatedSession | null;
export declare function saveDelegatedSession(s: DelegatedSession): void;
export declare function clearDelegatedSession(): void;
/**
 * The enrolled credential, whether or not a relay was ever found for it.
 *
 * A connected session is authoritative: it carries the same three fields and a
 * relay, so it is read first and the standalone record is the fallback. Without
 * that order a stale record from an earlier enrolment could out-rank the account
 * actually connected.
 */
export declare function readDelegatedCredential(): DelegatedCredential | null;
export declare function saveDelegatedCredential(c: DelegatedCredential): void;
export declare function clearDelegatedCredential(): void;
/**
 * A warrant nonce is spent on the node, so the counter must outlive the page.
 *
 * In `localStorage`, not session: a reload that restarted from zero would
 * replay a spent nonce and be refused. Keyed by relay and context because the
 * ledger the node keeps is per `(context, author device)`.
 *
 * No node serves a "where does my sequence stand" lookup (core #4018), so
 * holding the counter locally is the only option, and losing storage means
 * burning refusals until the counter catches up.
 */
export declare function persistedNonces(relayUrl: string): {
    next: () => Promise<bigint>;
};
/**
 * Record that `nonce` is spent for this device, so later intents start above
 * it. A creation warrant's nonce is spent in the NEW context's own window; one
 * sequence per relay covers that context like any other.
 */
export declare function markContextNonceSpent(relayUrl: string, _contextId: string, nonce: bigint): void;
/**
 * Pin a relay's device signing key, hex (32 bytes), learned out of band.
 *
 * `login()` binds the session to this key, and it must never be read from the
 * relay being logged in to — the answering party would choose what the device
 * signs about. Until the cloud publishes it (mdma#312), it comes from the
 * relay's operator.
 */
export declare function pinRelayNodeKey(relayUrl: string, nodeKey: string): void;
/** The pinned key for a relay, or `null` if none was pinned. */
export declare function readPinnedRelayNodeKey(relayUrl: string): string | null;
/**
 * One attempt at a relay's node key, and what became of it:
 *
 * - `learned`: verified (or already pinned), and pinned now;
 * - `unavailable`: something on the way did not answer — the relay, the release
 *   mirror, the quote library's download. Nothing was decided; try again.
 * - `refused`: the relay answered and its proof did not hold — a quote that is
 *   not of a trusted image, not bound to this request, a mock from a hosted
 *   relay. Trying again cannot change that answer into a yes, and must not.
 */
export type RelayNodeKeyAttempt = {
    kind: 'learned';
    nodeKey: string;
} | {
    kind: 'unavailable';
    error: unknown;
} | {
    kind: 'refused';
    error: unknown;
};
/**
 * The relay's node key: the pinned one, or else learned from the relay's TEE
 * attestation (see mero-js `attestRelayNodeKey`) and pinned for next time.
 *
 * A mock quote proves nothing about hardware, so one is accepted only from a
 * loopback relay — a local rig. A real one must be a signed release of the
 * trusted profile ({@link relayQuoteVerifier}).
 *
 * `fresh` skips the pin and attests now, for a step that hands the relay
 * something it keeps — founding a namespace through it. A pinned key was
 * checked once, on some earlier day, against whatever answered then.
 */
export declare function attemptRelayNodeKey(relayUrl: string, options?: {
    fresh?: boolean;
}): Promise<RelayNodeKeyAttempt>;
/**
 * The relay's node key: the pinned one, or else learned from the relay's TEE
 * attestation in one attempt; `null` when that attempt did not learn it, for
 * whatever reason. Callers that must end up with the key use
 * {@link learnRelayNodeKey}.
 */
export declare function resolveRelayNodeKey(relayUrl: string): Promise<string | null>;
/**
 * How long to wait before each retry of an unavailable relay key: quickly at
 * first, for a blip or a cold cache, then every 30 s for as long as it takes.
 */
export declare const RELAY_NODE_KEY_RETRY_MS: readonly number[];
/**
 * The relay's node key, however long the way to it is down.
 *
 * One failed fetch of the release used to cost the whole session: no key, so no
 * relay session, so every admin read and every event stream unauthenticated
 * until a reload. A transport failure here is now waited out with backoff
 * ({@link RELAY_NODE_KEY_RETRY_MS}) until the key is learned or `signal` aborts.
 *
 * A refusal ends it at once with `null`. A quote that did not verify is an
 * answer, and asking again is not how it becomes a different one.
 */
export declare function learnRelayNodeKey(relayUrl: string, options?: {
    signal?: AbortSignal;
}): Promise<string | null>;
/** Forget every relay's sealed transport. For tests. */
export declare function forgetRelaySealing(): void;
/**
 * The `fetch` a delegated session uses for `relayUrl`: sealed to its attested
 * TD, one per relay so its session is shared. `undefined` for a loopback relay,
 * a dev rig answering mock quotes, which keeps the global `fetch`.
 */
export declare function relayTransportFetch(relayUrl: string): typeof fetch | undefined;
/** Forget what was learned about which methods read. For tests. */
export declare function forgetMethodKinds(): void;
/**
 * Build the client a delegated session talks through.
 *
 * The result is a relay-transport `MeroClient`. Its `rpc.execute` takes the same
 * named arguments a node client's does, which is what lets a generated ABI
 * client — and every hook that only calls `execute` — work unchanged. What it
 * also has is `admin` and `events`, pointed at the relay and authenticated as
 * the account by the device certificate, so the caller-scoped reads answer this
 * account's own contexts and namespaces rather than the node's.
 */
export declare function buildDelegatedClient(s: DelegatedSession, _contextId: string | null): MeroClient | null;
export interface RelayMap {
    namespaces: Record<string, string>;
    contexts: Record<string, string>;
}
export declare function readRelayMap(account: string): RelayMap;
/** Record the relay that admitted this account to a namespace (and, when known, the context it came for). */
export declare function rememberRelay(account: string, relayUrl: string, at: {
    namespaceId?: string;
    contextId?: string;
}): void;
/** The relay that serves a context, if this account has learned it. */
export declare function relayForContext(account: string, contextId: string): string | null;
/**
 * A session moving to `next`, keeping the relay's executor account the previous
 * one knew when both are the same relay.
 *
 * A join hands back a session built from the admitting node alone, which has no
 * executor on it. When that node is the relay the account was already on — the
 * one the cloud assigned it, say — dropping the executor would cost nothing
 * today (the joined namespace can answer for it) but leaves the session knowing
 * less than it did. On a different relay the old executor is the wrong account,
 * so it is left behind.
 */
export declare function carryExecutorAccount(prev: DelegatedSession | null, next: DelegatedSession): DelegatedSession;
/** Every relay this account is known to use: the session's, and each in the map. */
export declare function knownRelays(s: DelegatedSession): string[];
/**
 * Thrown by {@link listDelegatedContexts} and {@link listDelegatedNamespaces}
 * when the account knows relays and **none** of them answered.
 *
 * One relay down is skipped, as before: the others still answer for what they
 * serve. Every relay down is different. Returning `[]` then reads as "a member
 * of nothing", and an app renders an empty account, with no error, for what is
 * really "could not ask". A relay whose hostname no longer resolves (a node
 * rebuilt or deleted in the cloud) did exactly that.
 */
/**
 * Why one relay did not answer a listing.
 *
 * `refused`: its attestation did not verify (an untrusted image, a release
 * below the floor). Asking again cannot change that, and it may be worth a
 * closer look. `unavailable`: something on the way did not answer, or the
 * relay refused the request itself; trying again later may.
 */
export interface RelayListingFailure {
    relayUrl: string;
    kind: 'refused' | 'unavailable';
    error: unknown;
}
export declare class RelaysUnavailableError extends Error {
    readonly failures: readonly RelayListingFailure[];
    readonly relays: readonly string[];
    constructor(failures: readonly RelayListingFailure[]);
    /** Every relay refused its attestation: retrying will not help. */
    get refused(): boolean;
}
type ListedContext = Awaited<ReturnType<MeroClient['admin']['getContexts']>>['contexts'][number];
/**
 * This account's contexts on every relay it knows, each tagged with the relay
 * that listed it — and that relay recorded as the one serving it.
 *
 * Each relay answers only for itself and only for this caller, so the union is
 * exactly the account's contexts across relays. A relay that cannot be reached
 * or logged in to is skipped (its contexts simply do not appear), not fatal,
 * unless it is every relay: then {@link RelaysUnavailableError}.
 */
export declare function listDelegatedContexts(s: DelegatedSession): Promise<Array<ListedContext & {
    relayUrl: string;
}>>;
type ListedNamespace = Awaited<ReturnType<MeroClient['admin']['listNamespaces']>>[number];
/**
 * This account's namespaces on every relay it knows, each tagged with the relay
 * that listed it and recorded as that namespace's relay. Same rules as
 * {@link listDelegatedContexts}: each relay answers for itself and this caller
 * only (`namespace:list-own`); an unreachable relay is skipped, and every
 * relay unreachable is {@link RelaysUnavailableError}.
 */
export declare function listDelegatedNamespaces(s: DelegatedSession): Promise<Array<ListedNamespace & {
    relayUrl: string;
}>>;
export {};
