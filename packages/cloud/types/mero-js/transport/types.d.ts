/**
 * One call shape, two ways of getting there.
 *
 * # Why the node shape is the canonical one
 *
 * `RpcClient.execute({ contextId, method, argsJson })` is what every app in the
 * fleet already writes, and `RelayClient.execute(contextId, method, argsJson)`
 * is what the delegated path grew independently. They differ in *both* halves —
 * positional vs. named arguments, and `T` vs. `IntentResult<T>`. A caller that
 * wanted to switch transports therefore had to rewrite every call site, which
 * makes the transport a property of the application rather than of the
 * connection.
 *
 * This interface closes that by declaring the node's shape the contract and
 * adapting the relay to it. The direction is deliberate and not symmetric:
 * shipped code uses the node shape, so any other choice would be a breaking
 * change dressed up as an abstraction.
 *
 * # Why subscription is not a method on this interface
 *
 * Not because a relay cannot be observed — it can; a relay is an ordinary node
 * and a keyholder can log in to it (see `./relay-observer.ts`). It is because
 * `RpcClient` satisfies this interface *as it already ships*, and `RpcClient`
 * has never had a `subscribe`. Adding one would change the canonical shape,
 * which is the single thing this work must not do.
 *
 * Observation therefore lives on `MeroClient` — `client.events`, `client.ws` —
 * where it lives for a node client, and is the same call on both transports.
 * {@link ExecuteTransport.canSubscribe} reports whether it will work, so an app
 * can branch on data rather than on a thrown error.
 */
import type { ExecuteParams, MigrateMyEntriesSummary } from '../rpc/index.js';
/** Which path a write takes. `'node'` is the default everywhere. */
export type TransportKind = 'node' | 'relay';
/**
 * A method's return value plus whatever the transport knew about the write.
 *
 * The canonical `execute` returns `T` and nothing else, because that is what
 * every existing call site expects. The relay, though, also learns the
 * context's scope root after the run — the one cheap way to tell "this changed
 * something" from "this was a no-op" — and discarding it to fit the node shape
 * would lose information the node genuinely does not have.
 *
 * So it is carried here, on a second method, rather than on a mutable
 * `lastIntent` accessor. That alternative was rejected on purpose: two
 * `execute` calls in flight at once would race for the same slot, and the
 * caller reading it has no way to tell whose answer it got.
 */
export interface ExecuteResult<T = unknown> {
    /** Exactly what `execute` would have returned. */
    returns: T;
    /** Which transport ran it. */
    transport: TransportKind;
    /**
     * The context's scope root after the run, hex — relay only.
     *
     * Absent on the node transport because JSON-RPC `execute` does not report it,
     * not because it was dropped. `undefined` therefore means "unknown here", and
     * must never be read as "nothing changed".
     */
    rootHash?: string;
}
/**
 * The write surface an app codes against, whichever transport is underneath.
 *
 * `RpcClient` satisfies this as-is — that is the point of picking its shape —
 * so an app already holding one is already holding an `ExecuteTransport`.
 */
export interface ExecuteTransport {
    /** Which path this is. Useful for diagnostics and for feature-gating UI. */
    readonly kind: TransportKind;
    /**
     * Whether this transport can observe events **as configured**.
     *
     * Always `true` on the node transport, which holds a credential on the node
     * it is pointed at. On the relay transport it depends on whether the caller
     * supplied the relay node's device signing key: the relay serves `/sse` and
     * `/ws` like any node, but a login statement must be signed against a key
     * learned out of band, and that key cannot be read from the node or derived
     * from its `peerId`.
     *
     * Reported rather than attempted, so an app branches before it subscribes.
     * `false` never means "try anyway and we'll connect to something else" —
     * nothing here will silently pick a node the app did not choose.
     */
    readonly canSubscribe: boolean;
    /** Run one method in one context. The canonical signature. */
    execute<T = unknown>(params: ExecuteParams): Promise<T>;
    /**
     * The same call, with whatever the transport knows about the write.
     *
     * Use it when the extra metadata matters; `execute` stays the one an app
     * reaches for, so that switching transports changes no call site.
     */
    executeWithMetadata<T = unknown>(params: ExecuteParams): Promise<ExecuteResult<T>>;
    /** One-tap owner-driven convert. See `RpcClient.migrateMyEntries`. */
    migrateMyEntries(contextId: string): Promise<MigrateMyEntriesSummary>;
    /** Read-only count of the caller's entries still below the target schema. */
    countMyPending(contextId: string): Promise<number>;
}
