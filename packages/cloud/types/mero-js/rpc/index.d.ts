import type { HttpClient } from '../http-client/index.js';
/** Result of the owner-driven `migrate_my_entries` convert (counts are u32). */
export interface MigrateMyEntriesSummary {
    converted: number;
    remaining: number;
}
export interface ExecuteParams {
    contextId: string;
    method: string;
    argsJson?: Record<string, unknown>;
    /** @deprecated No longer used by the server. Ignored if provided. */
    executorPublicKey?: string;
}
export declare class RpcError extends Error {
    code: number;
    type?: string;
    data?: unknown;
    constructor(code: number, message: string, data?: unknown, type?: string);
}
/**
 * POST a JSON-RPC call and unwrap `result`, converting an `error` payload into
 * an `RpcError`. The node returns `{ type, data }` (not always `{ code,
 * message }`), so this is the one place that normalization lives — every
 * JSON-RPC caller in this SDK shares it rather than re-deriving a bare
 * `Error(message)` and dropping the typed detail.
 */
export declare function jsonRpcCall<T>(httpClient: HttpClient, method: string, params: unknown): Promise<T>;
export declare class RpcClient {
    private httpClient;
    /**
     * Which write path this is. Present so `RpcClient` satisfies
     * `ExecuteTransport` as-is — the transport abstraction adopted *this* class's
     * `execute` shape as the canonical one, so the node side is the interface
     * rather than an adapter onto it.
     */
    readonly kind: "node";
    /** A node serves `/sse` and `/ws` to the credential it issued. */
    readonly canSubscribe = true;
    constructor(opts: {
        httpClient: HttpClient;
    });
    execute<T = unknown>(params: ExecuteParams): Promise<T>;
    /**
     * The same call, in the shape the transport abstraction shares with the
     * relay.
     *
     * `rootHash` is left absent rather than synthesized: JSON-RPC `execute` does
     * not report the context's scope root, and inventing a value — or a `''` —
     * would make "the node does not tell us" indistinguishable from an answer.
     */
    executeWithMetadata<T = unknown>(params: ExecuteParams): Promise<{
        returns: T;
        transport: 'node';
    }>;
    /**
     * One-tap owner-driven convert: re-signs the caller's identity-gated entries
     * to the current schema. The export converts all of the caller's
     * below-target entries in a single sweep, so this issues one call and returns
     * the resulting summary — it does not loop.
     */
    migrateMyEntries(contextId: string): Promise<MigrateMyEntriesSummary>;
    /** Read-only count of the caller's entries still below the target schema. */
    countMyPending(contextId: string): Promise<number>;
}
