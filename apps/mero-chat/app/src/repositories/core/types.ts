/**
 * Repository core — layered reads with an explicit, per-repository policy.
 *
 * # Why this exists
 *
 * Data in this app arrives from a node over the network, is expensive to fetch,
 * and is read from many unrelated components. Without somewhere to put that
 * concern, every caller invents its own answer: one bakes the value into
 * whatever object it was already holding, another keeps it in a `useState`,
 * another stashes it in `localStorage` under an ad-hoc key. They then disagree,
 * and the disagreement is invisible until a user notices the same thing shown
 * two different ways.
 *
 * A repository is the single place that answers "what is the current value for
 * this key", and a policy is the written-down decision about how hard it tries.
 * The policies differ per domain and the differences are deliberate — see each
 * repository's own `policy.ts`.
 */

/** Where a value came from. Useful in tests and for reasoning about staleness. */
export type ValueOrigin = "memory" | "storage" | "source";

export interface Resolved<V> {
  value: V | undefined;
  origin: ValueOrigin;
  /** Epoch ms the value was fetched from the SOURCE, not when it was cached. */
  fetchedAt: number;
}

/**
 * A durable, best-effort cache surviving reloads.
 *
 * Asynchronous because the storage worth using is. `localStorage` is
 * synchronous, which is convenient for exactly one thing — values are present
 * on the first paint — and costs a main-thread stall on every write, a ~5 MB
 * ceiling, and no way to query. IndexedDB gives range queries, Blobs, real
 * capacity and non-extractable `CryptoKey` storage; the price is that a
 * repository hydrates shortly after construction rather than instantly, which
 * shows as a brief placeholder on reload. That is the right trade, and the
 * interface is async so the good engine is expressible rather than the
 * convenient one.
 *
 * Every method must swallow its own failures: storage can be full, disabled, or
 * throw in private browsing, and none of that is a reason to fail a read that
 * the source can still answer.
 */
export interface PersistentLayer<V> {
  read(): Promise<Map<string, Resolved<V>>>;
  write(entries: Map<string, Resolved<V>>): Promise<void>;
  clear(): Promise<void>;
}

/** The authority. Batched, because per-key round trips are what made this slow. */
export interface SourceLayer<V> {
  /**
   * Load the authoritative values.
   *
   * Returning a key with `undefined` asserts "the source has no value for this"
   * — which is different from omitting it, meaning "I could not answer". Only
   * the first is worth negative-caching.
   */
  load(keys: string[]): Promise<Map<string, V | undefined>>;
}

export interface RepositoryPolicy {
  /**
   * How long a value from the source stays fresh.
   *
   * `Infinity` means immutable-once-known: only an explicit invalidation
   * replaces it.
   */
  ttlMs: number;

  /**
   * Serve a stale value immediately and refresh behind it.
   *
   * Right when a slightly-old answer is better than a spinner (a display name).
   * Wrong when a stale answer is actively misleading (an authorization check).
   */
  staleWhileRevalidate: boolean;

  /**
   * Survive a reload on disk.
   *
   * A deliberate decision per domain, not a default. Browser storage —
   * IndexedDB included — is plaintext and readable by any script on the origin,
   * so this is a question about the data, not about the engine. This app's
   * premise is that conversations are readable only by their participants;
   * writing message bodies to disk in the clear undercuts that, which is why
   * they do not set it.
   */
  persist: boolean;

  /**
   * How long "the source has no value for this key" is remembered.
   *
   * Without it, every render of a member who genuinely has no name re-asks the
   * node forever. `0` disables negative caching.
   */
  negativeTtlMs: number;

}
