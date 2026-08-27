import type {
  PersistentLayer,
  RepositoryPolicy,
  Resolved,
  SourceLayer,
} from "./types";

/**
 * Reads through memory → persistent storage → source, governed by a policy.
 *
 * Three properties are load-bearing and worth stating, because each one exists
 * to stop a specific failure this app has already had:
 *
 * 1. **Batching.** Concurrent misses for different keys coalesce into one
 *    source call per tick. A message list renders 200 rows at once; without
 *    this it asks the node 200 times for what one request answers.
 *
 * 2. **Single-flight.** A key already in flight is awaited rather than
 *    re-requested, so a re-render storm cannot multiply load.
 *
 * 3. **Negative caching.** "The source has no value" is a real answer and is
 *    remembered, so a member without a name does not re-trigger a fetch on
 *    every render forever.
 *
 * Subscribers are notified when values land, so React can re-render without
 * anyone polling.
 */
export class LayeredRepository<V> {
  private memory = new Map<string, Resolved<V>>();
  private inFlight = new Map<string, Promise<void>>();
  private pending = new Set<string>();
  private flushHandle: ReturnType<typeof setTimeout> | null = null;
  private subscribers = new Set<() => void>();
  private hydration: Promise<void> | null = null;

  constructor(
    private readonly source: SourceLayer<V>,
    private readonly policy: RepositoryPolicy,
    private readonly persistent?: PersistentLayer<V>,
  ) {
    if (this.policy.persist && this.persistent) {
      // Hydrate from durable storage so a reload does not re-fetch everything.
      //
      // Asynchronous, so the first paint may show placeholders for a frame —
      // the cost of using storage worth having. Values already fetched in the
      // meantime win: a source answer is authoritative and must not be
      // overwritten by an older cached one that happens to land after it.
      this.hydration = this.persistent
        .read()
        .then((stored) => {
          for (const [key, entry] of stored) {
            if (!this.memory.has(key)) this.memory.set(key, entry);
          }
          this.notify();
        })
        .catch(() => {
          // Durable caching is an optimisation; losing it must not break reads.
        });
    }
  }

  /** Resolves once durable storage has been read. For tests and first paint. */
  get hydrated(): Promise<void> {
    return this.hydration ?? Promise.resolve();
  }

  /** Currently-known value. Never triggers a fetch — safe in a render. */
  peek(key: string): V | undefined {
    return this.memory.get(key)?.value;
  }

  /**
   * Known value, plus a fetch when it is missing or stale.
   *
   * Returns synchronously so a component can render immediately. Under
   * `staleWhileRevalidate` a stale value is returned AND refreshed; otherwise a
   * stale value is withheld until the refresh lands.
   */
  get(key: string): V | undefined {
    const hit = this.memory.get(key);
    const fresh = hit ? !this.isExpired(hit) : false;

    if (!fresh) this.enqueue(key);
    if (!hit) return undefined;

    return fresh || this.policy.staleWhileRevalidate ? hit.value : undefined;
  }

  /** Await the authoritative value, bypassing staleness but not the batcher. */
  async resolve(key: string): Promise<V | undefined> {
    const hit = this.memory.get(key);
    if (hit && !this.isExpired(hit)) return hit.value;
    this.enqueue(key);
    await this.inFlight.get(key);
    return this.memory.get(key)?.value;
  }

  /**
   * Drop a key so the next read re-fetches.
   *
   * The rename path: a value changed at the source and no TTL should decide how
   * long the old one is still shown.
   */
  invalidate(key?: string): void {
    if (key === undefined) {
      this.memory.clear();
    } else {
      this.memory.delete(key);
    }
    this.persist();
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private isExpired(entry: Resolved<V>): boolean {
    const ttl =
      entry.value === undefined ? this.policy.negativeTtlMs : this.policy.ttlMs;
    if (ttl === Infinity) return false;
    if (ttl === 0) return true;
    return Date.now() - entry.fetchedAt > ttl;
  }

  private enqueue(key: string): void {
    if (this.inFlight.has(key) || this.pending.has(key)) return;
    this.pending.add(key);
    if (this.flushHandle !== null) return;
    // Coalesce everything requested in this tick into one source call.
    this.flushHandle = setTimeout(() => void this.flush(), 0);
  }

  private async flush(): Promise<void> {
    this.flushHandle = null;
    const keys = [...this.pending];
    this.pending.clear();
    if (keys.length === 0) return;

    const run = (async () => {
      let loaded: Map<string, V | undefined>;
      try {
        loaded = await this.source.load(keys);
      } catch {
        // The source could not answer. Record nothing: an unanswered request is
        // not the same as "no value", and caching it as one would hide the key
        // behind `negativeTtlMs` when the node comes back.
        return;
      }

      const now = Date.now();
      for (const key of keys) {
        if (!loaded.has(key) && this.policy.negativeTtlMs === 0) continue;
        this.memory.set(key, {
          value: loaded.get(key),
          origin: "source",
          fetchedAt: now,
        });
      }
      this.persist();
      this.notify();
    })();

    for (const key of keys) this.inFlight.set(key, run);
    try {
      await run;
    } finally {
      for (const key of keys) this.inFlight.delete(key);
    }
  }

  private persist(): void {
    if (!this.policy.persist || !this.persistent) return;
    // Fire-and-forget: a read must never wait on the durable copy, and a
    // failure to write it is not a failure to answer.
    void this.persistent.write(this.memory).catch(() => {});
  }

  private notify(): void {
    this.subscribers.forEach((fn) => {
      try {
        fn();
      } catch {
        // One bad subscriber must not stop the others being told.
      }
    });
  }
}
