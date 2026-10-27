/**
 * An account's ephemeral presence, through its relay.
 *
 * A node publishes and heartbeats its own presence; an account has no node, so
 * this client signs each update with the device key, posts it to the relay's
 * `presence-intents`, and resends the last state every 2.5 s until
 * `set(contextId, null)` or `close()`. The relay checks the update and seals
 * and gossips it; other members verify the device's signature and certificate
 * themselves, so the relay cannot invent or alter an account's presence.
 */
import type { SseClient } from '../events/index.js';
import type { Codec, EphemeralEntry } from '../ephemeral/types.js';
import type { RelayClient } from '../relay/relay-client.js';
type PresenceRelay = Pick<RelayClient, 'authorProof' | 'authorSigner' | 'presenceIntent'>;
export declare class RelayPresenceClient {
    private readonly relay;
    private readonly events;
    private readonly heartbeatMs;
    private readonly now;
    private readonly timers;
    private readonly lastSeq;
    private readonly refused;
    /**
     * Bumped by every `set` and `close`, per context. A `set` installs its
     * resends only if nothing newer happened while its first send was in flight,
     * so a retract (or a newer state) can never be overtaken by an older one.
     */
    private readonly generation;
    /**
     * @param opts.events the relay's event stream, asked for only on `subscribe`:
     *   publishing needs none, so a client with no node key can still publish.
     */
    constructor(opts: {
        relay: PresenceRelay;
        events: () => SseClient;
        heartbeatMs?: number;
        now?: () => number;
    });
    /**
     * Set this account's presence in `contextId`, or retract it with `null`.
     * Throws when the relay refuses this first send for good (a 4xx other than
     * 429), which also stops the resends. A rate limit, a network failure or a
     * 5xx is not thrown: the next resend covers it.
     */
    set<T>(contextId: string, state: T | null, codec?: Codec<T>): Promise<void>;
    subscribe<T>(contextId: string, handler: (entry: EphemeralEntry<T>) => void, codec?: Codec<T>): () => void;
    /** Stop every resend. Entries expire on the relay and its peers within 7 s. */
    close(): void;
    /** Stop the context's resends and invalidate any `set` still in flight. */
    private bump;
    private stop;
    /** Wall-clock seeded and strictly rising, so a relay restart never sees an old seq. */
    private nextSeq;
    private send;
}
export {};
