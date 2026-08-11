// Pure, transport- and React-free dedupe kernel of the Yjs provider: decides
// which fetched update blobs are NEW (apply) vs already-seen (skip).
//
// The WASM stores each doc's body as an add-only, idempotent set of opaque Yjs
// update blobs (`content_updates`). Y.applyUpdate is itself idempotent and
// commutative, so the dedupe here is not a convergence requirement — but it IS
// load-bearing for breaking the local⇄remote feedback loop: a blob we just
// emitted comes back via SSE and must not be re-applied (which would emit a
// fresh local update and ping-pong forever).
//
// Dependency-free (no Web Crypto) so it unit-tests without an editor or DOM.

/**
 * COLLISION-FREE dedupe key for an update blob: its full bytes, hex-encoded —
 * two blobs share a key iff byte-for-byte identical. A lossy *hash* key could
 * collide and silently DROP a genuinely distinct update as already-seen (a
 * convergence bug); the full-bytes key removes that failure mode. Blobs are few
 * and small (a flush coalesces a keystroke burst via `Y.mergeUpdates`), so the
 * exact hex string is cheap, synchronous, and works identically in jsdom tests.
 */
// byte → two-char lowercase hex, built once so keying is an array fill + join.
const BYTE_TO_HEX: string[] = Array.from({ length: 256 }, (_, b) =>
  b.toString(16).padStart(2, '0'),
);

export function hashUpdate(update: Uint8Array): string {
  // Fill a fixed-size array and join ONCE: repeated `key += ...` is O(n²) (each
  // `+=` re-allocates the growing string); array fill + single join is O(n).
  const chars = new Array<string>(update.length);
  for (let i = 0; i < update.length; i++) {
    chars[i] = BYTE_TO_HEX[update[i]];
  }
  return chars.join('');
}

/**
 * Cap on remembered blob keys. The set is only an echo/dedupe guard, not a
 * correctness store: an evicted blob was synced long ago and won't be
 * re-delivered, and if it somehow is, Y.applyUpdate is idempotent. Capping
 * bounds memory for a long editing session.
 */
export const DEFAULT_SEEN_CAPACITY = 2048;

/**
 * Tracks which update blobs have been seen (emitted or applied) so re-delivery
 * is a cheap no-op, keyed by content. BOUNDED with FIFO eviction: a JS `Set`
 * iterates in insertion order, so the oldest key is `seen.values().next()`.
 */
export class SeenUpdates {
  private readonly seen = new Set<string>();
  private readonly capacity: number;

  constructor(capacity: number = DEFAULT_SEEN_CAPACITY) {
    // Guard against a non-positive cap pinning the set to empty.
    this.capacity = capacity > 0 ? Math.floor(capacity) : DEFAULT_SEEN_CAPACITY;
  }

  /** True if this blob has already been recorded. */
  has(update: Uint8Array): boolean {
    return this.seen.has(hashUpdate(update));
  }

  /**
   * Record a blob as seen. Returns true if it was NEW, false if already
   * recorded. Evicts the oldest key(s) once over capacity (FIFO).
   */
  add(update: Uint8Array): boolean {
    const key = hashUpdate(update);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    while (this.seen.size > this.capacity) {
      // Oldest insertion-order entry (defined: size > capacity > 0).
      const oldest = this.seen.values().next().value as string;
      this.seen.delete(oldest);
    }
    return true;
  }

  get size(): number {
    return this.seen.size;
  }
}

/**
 * Return the candidate blobs from a fetched batch: those not already seen, not
 * known-bad, and not intra-batch duplicates.
 *
 * Deliberately does NOT record anything as seen. Selection and commitment are
 * separate because `Y.applyUpdate` can throw on a malformed blob: marking a
 * batch seen up front meant one bad blob aborted the batch while every blob in
 * it was already recorded, so the good updates were never selected again and
 * those peer edits were lost for good. The caller records each blob only once
 * it has actually applied.
 *
 * `poisoned` holds blobs that previously failed to apply. They are excluded so
 * a permanently bad blob — the log is add-only, so it never goes away — is not
 * retried on every pull, without being conflated with successfully applied ones.
 */
export function selectUnseenUpdates(
  fetched: readonly Uint8Array[],
  seen: SeenUpdates,
  poisoned?: SeenUpdates,
): Uint8Array[] {
  const out: Uint8Array[] = [];
  const batch = new SeenUpdates(fetched.length > 0 ? fetched.length : 1);
  for (const blob of fetched) {
    if (blob.length === 0) continue; // the WASM rejects empty; skip defensively
    if (seen.has(blob)) continue;
    if (poisoned?.has(blob)) continue;
    if (!batch.add(blob)) continue; // intra-batch duplicate
    out.push(blob);
  }
  return out;
}
