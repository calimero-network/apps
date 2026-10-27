/**
 * The relay, wearing the node's `execute` shape.
 *
 * This is an adapter and nothing else: it owns no protocol, mints no warrant
 * and holds no key. `RelayClient` does all of that and stays the place to look
 * when a write is refused. What lives here is the two differences that stopped
 * an app from swapping one for the other — named arguments instead of
 * positional, and `T` instead of `IntentResult<T>`.
 *
 * The unwrap is the load-bearing part: `IntentResult<T>` becomes `T`, so a call
 * site cannot tell which transport ran it.
 *
 * A method's `null` return is passed through as `null` rather than normalized
 * to `undefined`. That looks like the less tidy choice and is the correct one:
 * `RpcClient.execute` returns `result.output` verbatim, so a node method whose
 * output is `null` already resolves to `null` today. Rewriting the relay's
 * `null` would make the two transports disagree in exactly the case this
 * adapter exists to make agree. The alternative — normalizing *both* sides to
 * `undefined` — was rejected because it changes what shipped node call sites
 * see, which is the one thing this work must not do.
 *
 * The `rootHash` the relay also reports is NOT discarded — it comes back from
 * {@link RelayTransport.executeWithMetadata}.
 */
import type { ExecuteParams, MigrateMyEntriesSummary } from '../rpc/index.js';
import type { RelayClient } from '../relay/relay-client.js';
import type { ExecuteResult, ExecuteTransport, TransportKind } from './types.js';
import type { RelayObserver } from './relay-observer.js';
export declare class RelayTransport implements ExecuteTransport {
    private readonly relay;
    /**
     * How this transport observes, or `null` when nobody supplied the relay
     * node's signing key. Held here rather than on `MeroClient` so that
     * {@link RelayTransport.canSubscribe} — which an app may read off
     * `client.rpc` — answers about the thing it is actually asked about.
     */
    private readonly observer;
    readonly kind: TransportKind;
    constructor(relay: RelayClient, 
    /**
     * How this transport observes, or `null` when nobody supplied the relay
     * node's signing key. Held here rather than on `MeroClient` so that
     * {@link RelayTransport.canSubscribe} — which an app may read off
     * `client.rpc` — answers about the thing it is actually asked about.
     */
    observer?: RelayObserver | null);
    /**
     * Whether this relay can be observed — a fact, not a constant.
     *
     * A relay IS a node: it serves `/auth/challenge`, `/auth/token`, `/sse` and
     * `/ws`, and the `account_proof` provider grants `context:subscribe` by
     * default. What decides the answer is therefore not the transport but whether
     * a caller supplied the node's device signing key, which cannot be inferred
     * from the node or from its `peerId`. See `./relay-observer.ts`.
     */
    get canSubscribe(): boolean;
    /** The event session, or `null` when no node key was supplied. */
    get events(): RelayObserver | null;
    /** The underlying client, for `describe()` and anything else relay-specific. */
    get client(): RelayClient;
    execute<T = unknown>(params: ExecuteParams): Promise<T>;
    executeWithMetadata<T = unknown>(params: ExecuteParams): Promise<ExecuteResult<T>>;
    /**
     * Both of these are plain context methods, so they work through a relay
     * exactly as they do on a node — the warrant names `migrate_my_entries` and
     * the delta is attributed to the author, which is precisely the identity the
     * convert is scoped to. They are re-declared rather than inherited because
     * `ExecuteTransport` is an interface, not a base class.
     */
    migrateMyEntries(contextId: string): Promise<MigrateMyEntriesSummary>;
    /** Read-only count of the caller's entries still below the target schema. */
    countMyPending(contextId: string): Promise<number>;
}
