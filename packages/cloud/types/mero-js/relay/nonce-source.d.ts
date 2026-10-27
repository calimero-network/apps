/**
 * Where a warrant's nonce comes from.
 *
 * # Why this is a named concept and not a counter in the relay client
 *
 * A warrant's nonce is spent, once, per `(context, author device)` on every
 * node that applies the delta. So the sequence a client emits is not a local
 * detail — it is state the network remembers, and the client is the only party
 * that can keep it.
 *
 * The receiving ledger is a **sliding window** 64 wide, not a high-water mark,
 * which is what makes the two failure modes so different:
 *
 * - **Skipping** numbers is free. Gossip gives no ordering, so the window
 *   exists precisely to accept whatever unseen nonce arrives.
 * - **Restarting** the sequence is fatal. A tab that reloads and resumes at `1`
 *   re-presents nonces the network has already spent, and every one of those
 *   writes is refused as a replay — indistinguishable, to the user, from the
 *   app silently not saving.
 *
 * That asymmetry is why persistence is the default here and an in-memory source
 * is the one you have to ask for. It is also why a source may jump: reserving a
 * block and losing the tail is the correct trade.
 */
/** Produces the next nonce for one author device. Must never go backwards. */
export interface NonceSource {
    next(): Promise<bigint>;
    /**
     * Raise the floor of the sequence to `floor`, if this source can record it.
     *
     * Optional, and additive: a source that does not implement it still works
     * everywhere a `NonceSource` is taken. Implementing it is what lets a caller
     * that learns a higher spent nonce out of band — a refusal naming the nonce,
     * say — skip ahead, and lets a *persistent* source remember that jump across
     * a cold start.
     *
     * Never lowers: a smaller `floor` than the source's own position is ignored.
     */
    advanceTo?(floor: bigint): Promise<void>;
}
/**
 * A counter in memory, starting at `start`.
 *
 * Correct only for a process whose lifetime is the whole sequence — a script, a
 * server-side worker that owns its own device key, a test. In a browser tab it
 * resets on reload and replays; use {@link createLocalStorageNonceSource}
 * there.
 */
export declare function createMemoryNonceSource(start?: number | bigint): NonceSource;
/**
 * A counter persisted in `localStorage`, so a reload continues the sequence.
 *
 * Key it per author **device**, not per account: two devices of one account are
 * independent replicas with independent sequences, and sharing a counter would
 * have them refusing each other's warrants.
 *
 * **Reserve-then-hand-out.** The stored value is advanced *before* the nonce is
 * returned, so a crash between the two loses a number rather than reusing one.
 * Losing a number costs nothing (the window accepts gaps); reusing one costs a
 * write.
 *
 * Concurrent tabs are the case this cannot fully solve, because `localStorage`
 * has no atomic read-modify-write. Two tabs racing can hand out the same nonce,
 * and the loser's write is refused as a replay rather than silently
 * misattributed — a visible error, not corruption. An app that genuinely writes
 * from several tabs at once should hold a Web Lock around `next()` or give each
 * tab its own device.
 */
export declare function createLocalStorageNonceSource(key: string, storage?: {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
}): NonceSource;
