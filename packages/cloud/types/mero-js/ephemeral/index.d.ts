import type { HttpClient } from '../http-client/index.js';
import type { SseClient } from '../events/index.js';
import { jsonCodec } from './codec.js';
import type { Codec, EphemeralEntry } from './types.js';
export { jsonCodec };
export type { Codec, EphemeralEntry };
/**
 * Ephemeral presence: transient, encrypted, never-persisted state (cursors,
 * typing, presence) that gossips between nodes without a WASM run or DAG
 * growth.
 *
 * The write/read asymmetry is the model, not an oversight. `set` takes no
 * author: you can only ever write your OWN slot, and the node resolves the
 * author server-side from its owned context identity — which is also why a
 * client cannot publish as somebody else. `subscribe` returns everyone's
 * slots, so each carries its `author`. The store is N independent
 * single-writer registers keyed by author; there is no merge across authors.
 *
 * There is a single read path: `subscribe`. On subscribing to a context, the
 * node replays that context's current presence to this connection as
 * ordinary `Ephemeral` events (carrying `ageMs`), before any live deltas
 * (which carry no `ageMs`). There is no separate snapshot RPC.
 */
export declare class EphemeralClient {
    private httpClient;
    private sse;
    constructor(opts: {
        httpClient: HttpClient;
        sse: SseClient;
    });
    /**
     * Publish your own presence slice, replacing it wholesale.
     *
     * Rejects with an `RpcError` (not a bare `Error`), so a typed failure such as
     * an oversized slice keeps its `type` and `data` — e.g. `SliceTooLarge` with
     * the offending size — and is `instanceof RpcError` like every other RPC in
     * this SDK.
     */
    set<T>(contextId: string, state: T, codec?: Codec<T>): Promise<void>;
    /**
     * Observe presence changes for a context.
     *
     * This adds NO transport — it is a typed filter over the existing SSE event
     * stream, which already carries `{ contextId, type, data }`. On subscribing,
     * the node replays that context's current presence to this connection as
     * ordinary `Ephemeral` events before any live deltas; a replayed entry
     * carries `ageMs`, a live delta does not (never synthesized as `0` — absent
     * and zero mean different things). Returns an unsubscribe function.
     */
    subscribe<T>(contextId: string, handler: (entry: EphemeralEntry<T>) => void, codec?: Codec<T>): () => void;
}
/**
 * Presence for one context off an event stream: a typed filter over the SSE
 * events that already carry `{ contextId, type, data }`. Shared by a node
 * client and an account's relay client, which read presence the same way.
 */
export declare function subscribePresence<T>(sse: SseClient, contextId: string, handler: (entry: EphemeralEntry<T>) => void, codec?: Codec<T>): () => void;
