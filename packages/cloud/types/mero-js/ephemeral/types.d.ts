/** Encoding for a presence slice. The node never deserializes it — the wire
 * encoding is chosen client-side and travels client-to-client. */
export interface Codec<T> {
    encode(value: T): number[];
    decode(bytes: number[]): T;
}
/** One entry from `subscribe`. `state` is absent on a removal; `removed` is
 * ABSENT (not false) on an upsert.
 *
 * On subscribing to a context, the node replays that context's current
 * presence to this connection as ordinary `Ephemeral` events (same shape as a
 * live delta), before any live deltas. `ageMs` distinguishes a replayed seed
 * entry from a live one: it is ABSENT on a live delta (fresh at receipt) and
 * PRESENT on a replayed entry, giving milliseconds since that author was last
 * heard from, measured on the node. Relative, so no clock agreement between
 * machines is needed. Bounded above by the node's 7s presence TTL. */
export interface EphemeralEntry<T> {
    author: string;
    /**
     * The account a relay-carried update's device certificate names, hex. Absent
     * for a node's own presence.
     */
    account?: string;
    state?: T;
    removed?: boolean;
    ageMs?: number;
}
