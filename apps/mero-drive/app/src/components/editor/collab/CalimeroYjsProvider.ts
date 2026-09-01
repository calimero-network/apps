// A Yjs "provider" backed by the Calimero docs CRDT instead of a live socket.
// The transport is the replicated docs WASM: a doc's body is an add-only,
// idempotent set of opaque Yjs update blobs (`content_updates`), and peer
// delivery rides the same SSE stream that drives the app's live refresh.
//
//   - LOCAL → LOG: a genuine local update is appended via `appendDocUpdate`,
//     debounced so a keystroke burst becomes a few RPCs, not one per transaction.
//   - LOG → LOCAL: `pullRemote()` (SSE refresh + startup) fetches the blob set,
//     dedupes against `seen`, and applies only new blobs with THIS provider as
//     the origin — so the resulting update is recognised as remote, not echoed.
//
// Convergence correctness lives in `./yjs-update-log` (unit-tested). This class
// is the wiring: Y.Doc events ⇄ transport, plus batching and teardown. Awareness
// is stubbed (no live cursors in v1).

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { SeenUpdates, selectUnseenUpdates } from './yjs-update-log';

export interface CalimeroYjsTransport {
  /** Append one opaque Yjs update blob to the doc's add-only log. Idempotent. */
  appendDocUpdate(update: Uint8Array): Promise<void>;
  /** Fetch the full set of update blobs for the doc (unordered). */
  getDocUpdates(): Promise<Uint8Array[]>;
}

export interface CalimeroYjsProviderOptions {
  /**
   * Coalesce window (ms) before flushing local updates. Yjs merges the queued
   * updates into one blob (`Y.mergeUpdates`), so one flush = one append.
   */
  flushDebounceMs?: number;
  /**
   * Max flush retries on transport failure before giving up (with a logged
   * error). Un-acked updates stay buffered across retries, so a transient
   * failure recovers without data loss.
   */
  maxFlushRetries?: number;
  /** Base backoff (ms) between flush retries; grows linearly per attempt. */
  retryBackoffMs?: number;
}

const DEFAULT_FLUSH_DEBOUNCE_MS = 400;
const DEFAULT_MAX_FLUSH_RETRIES = 5;
const DEFAULT_RETRY_BACKOFF_MS = 200;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class CalimeroYjsProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;

  private readonly transport: CalimeroYjsTransport;
  private readonly seen = new SeenUpdates();
  // Blobs that threw from Y.applyUpdate. Held apart from `seen` because the log
  // is add-only: a bad blob is re-delivered on every pull forever, so it has to
  // be skippable without being recorded as successfully applied.
  private readonly poisoned = new SeenUpdates();
  private readonly flushDebounceMs: number;
  private readonly maxFlushRetries: number;
  private readonly retryBackoffMs: number;

  // Un-acked LOCAL update blobs awaiting a flush. Kept as the ORIGINAL
  // per-transaction blobs (not merged), so on a flush failure we can re-buffer
  // exactly what wasn't acked — the originals are what's recorded in `seen`.
  private pendingLocal: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  // Serialises pulls so an SSE burst doesn't fire overlapping pulls (still
  // correct via dedupe, but wasteful).
  private pulling = false;
  private pullQueued = false;

  // Single-flight handle for the drain loop: concurrent callers (and destroy())
  // attach to this one promise rather than each starting their own loop.
  private flushInFlight: Promise<void> | null = null;

  constructor(
    doc: Y.Doc,
    transport: CalimeroYjsTransport,
    options: CalimeroYjsProviderOptions = {},
  ) {
    this.doc = doc;
    this.transport = transport;
    this.awareness = new Awareness(doc);
    this.flushDebounceMs = options.flushDebounceMs ?? DEFAULT_FLUSH_DEBOUNCE_MS;
    this.maxFlushRetries = options.maxFlushRetries ?? DEFAULT_MAX_FLUSH_RETRIES;
    this.retryBackoffMs = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
    this.doc.on('update', this.handleLocalUpdate);
  }

  /**
   * True when local edits are buffered or a flush is in flight. The status bar
   * reads this for "Saving…" vs "Saved". No event fires, so callers sample it.
   */
  get hasPendingWork(): boolean {
    return this.pendingLocal.length > 0 || this.flushInFlight !== null;
  }

  /**
   * Count of remote blobs that failed to apply and are being skipped. Non-zero
   * means this replica is missing peer edits it cannot recover, so it is worth
   * surfacing rather than leaving in the console.
   */
  get rejectedUpdateCount(): number {
    return this.poisoned.size;
  }

  private handleLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (this.destroyed) return;
    // ORIGIN GUARD (load-bearing): a blob WE applied from the log in
    // `pullRemote` carries `origin === this`. It's already in the log and in
    // `seen`, so re-buffering it would echo it back and (since applying emits
    // another update) loop forever. A genuine local edit has any other origin.
    if (origin === this) return;
    // Record our own emission so the same bytes coming back via the log are a
    // no-op in `pullRemote`.
    this.seen.add(update);
    this.pendingLocal.push(update);
    this.scheduleFlush();
  };

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush().catch((e) => {
        // Guard the fire-and-forget timer path against an unhandled rejection;
        // `flush()`'s retry/backoff already logged the detail.
        console.error('[CalimeroYjsProvider] scheduled flush failed', e);
      });
    }, this.flushDebounceMs);
  }

  /**
   * Flush queued local updates to the log. Public so a caller can force a flush
   * (e.g. before unmount). Single-flight: concurrent callers all await the SAME
   * drain loop. The drain is a flat loop (not recursion), and on transport
   * failure the original un-acked updates are re-buffered and retried with
   * bounded backoff before giving up with a logged error.
   */
  async flush(): Promise<void> {
    // If a drain loop is already running, ALWAYS attach to it regardless of
    // `pendingLocal.length`: the loop transiently empties the buffer mid-append
    // (`runFlush` snapshots then clears before its append resolves), so a caller
    // checking `length === 0` there would resolve before the append lands.
    // Attaching makes `await flush()` wait for the drain to fully finish.
    if (this.flushInFlight) {
      return this.flushInFlight;
    }
    if (this.pendingLocal.length === 0) return;

    // Publish the loop before its first await so a racing caller attaches
    // instead of starting a second loop. The loop clears `flushInFlight` itself
    // (see `drainLoop`), so an update enqueued in the clear window isn't stranded.
    const loop = this.drainLoop();
    this.flushInFlight = loop;
    return this.flushInFlight;
  }

  /**
   * The single drain loop: flush merged batches until the buffer is empty (flat
   * loop, never recursion). Stops once destroyed — destroy() runs its own final
   * drain. On terminal `runFlush` failure the originals are re-buffered and we
   * propagate so the caller learns the flush gave up rather than spinning.
   *
   * Clear-window safety: the `finally` clears `flushInFlight` ATOMICALLY with a
   * final re-check of `pendingLocal` (no `await` between them). An update
   * enqueued in that window — `handleLocalUpdate` runs synchronously — either
   * lands before the re-check (drained by a fresh loop started here) or after
   * the clear (sees no in-flight loop, `scheduleFlush` starts one). Either way
   * nothing is stranded. Only re-loop on a CLEAN exit, never after a throw
   * (which would spin on the same doomed blob).
   */
  private async drainLoop(): Promise<void> {
    let threw = true;
    try {
      while (this.pendingLocal.length > 0 && !this.destroyed) {
        await this.runFlush();
      }
      threw = false;
    } finally {
      if (!threw && this.pendingLocal.length > 0 && !this.destroyed) {
        const next = this.drainLoop();
        this.flushInFlight = next;
        await next;
      } else {
        this.flushInFlight = null;
      }
    }
  }

  /**
   * Append the buffered updates as one merged blob, with bounded retry/backoff.
   * Snapshots `pendingLocal` then clears it; on failure the snapshot (the
   * ORIGINAL per-transaction blobs) is restored to the FRONT so the next attempt
   * re-sends exactly what wasn't acked. Edits arriving during this call queue
   * behind the snapshot and flush on the loop's next iteration — never dropped.
   */
  private async runFlush(): Promise<void> {
    const batch = this.pendingLocal;
    this.pendingLocal = [];
    // Yjs updates are commutative, so merge the queued transactions into one
    // blob: one log entry per flush rather than one per keystroke.
    const merged = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);

    for (let attempt = 0; attempt <= this.maxFlushRetries; attempt++) {
      try {
        await this.transport.appendDocUpdate(merged);
        // The log stores the MERGED blob, so that's what the next pull echoes
        // back — record its identity so the echo dedupes. (For a single
        // original, `merged === batch[0]`, already in `seen`.)
        if (batch.length > 1) this.seen.add(merged);
        return; // acked
      } catch (e) {
        if (attempt >= this.maxFlushRetries) {
          // Give up rather than spin. Re-buffer the ORIGINALS at the front so a
          // later flush/edit can retry them, then surface the error.
          this.pendingLocal.unshift(...batch);
          console.error(
            `[CalimeroYjsProvider] appendDocUpdate failed after ${
              this.maxFlushRetries + 1
            } attempts; ${batch.length} update(s) left buffered for a later flush`,
            e,
          );
          throw e;
        }
        // Transient failure: back off, then retry the SAME merged blob (the
        // originals stay captured in `batch`, so nothing is lost on giving up).
        console.warn(
          `[CalimeroYjsProvider] appendDocUpdate attempt ${
            attempt + 1
          } failed; retrying`,
          e,
        );
        if (this.destroyed) {
          // Don't retry past teardown: re-buffer for the final drain and bail.
          this.pendingLocal.unshift(...batch);
          throw e;
        }
        await sleep(this.retryBackoffMs * (attempt + 1));
      }
    }
  }

  /**
   * Pull the remote log and apply any new blobs to the local doc. Call on every
   * SSE refresh and once at startup. Safe to call repeatedly — dedupe makes
   * re-delivery a no-op. Overlapping calls collapse to one pull plus a single
   * follow-up if more arrived meanwhile.
   */
  /**
   * Apply a batch of remote blobs, recording each as seen only once it lands.
   *
   * Fast path is one transaction for the whole batch: an initial pull can be
   * thousands of blobs, and per-blob transactions would fire the editor's
   * observers once each. If any blob throws, the batch is retried one at a
   * time to isolate it — `Y.applyUpdate` is idempotent, so re-applying the
   * ones that already landed before the throw is free.
   *
   * The transaction is tagged with this provider as origin so the update
   * handler's origin guard skips re-appending, which is what stops an applied
   * remote update echoing back out as a "local" change.
   */
  private applyRemote(fresh: Uint8Array[]): void {
    try {
      this.doc.transact(() => {
        for (const blob of fresh) Y.applyUpdate(this.doc, blob, this);
      }, this);
      for (const blob of fresh) this.seen.add(blob);
      return;
    } catch (e) {
      // Not necessarily a bad blob: Yjs fires observers inside the transaction,
      // so a throw from a downstream observer (y-prosemirror / BlockNote on an
      // unfamiliar block type) lands here too. Log before isolating, because in
      // that case the isolation pass below re-applies everything as no-ops,
      // fires no observer, rejects nothing, and would otherwise say nothing at
      // all — leaving the doc correct but the editor view silently stale.
      console.error(
        '[CalimeroYjsProvider] batch apply failed; retrying blob-by-blob',
        e,
      );
    }

    let rejected = 0;
    for (const blob of fresh) {
      try {
        this.doc.transact(() => {
          Y.applyUpdate(this.doc, blob, this);
        }, this);
        this.seen.add(blob);
      } catch (e) {
        rejected += 1;
        // Remember it as bad, NOT as seen: the log is add-only so this blob is
        // delivered on every pull forever, and it must not be mistaken for one
        // that applied.
        this.poisoned.add(blob);
        console.error(
          '[CalimeroYjsProvider] skipped an update that failed to apply',
          e,
        );
      }
    }
    if (rejected > 0) {
      console.error(
        `[CalimeroYjsProvider] ${rejected} update(s) could not be applied; ` +
          `${fresh.length - rejected} of this batch applied cleanly`,
      );
    } else {
      // Every blob applied on its own, so the batch failure came from something
      // other than the blobs — most likely an observer. Worth naming: it means
      // the document is right but whatever renders it may not be.
      console.error(
        `[CalimeroYjsProvider] all ${fresh.length} update(s) applied ` +
          `individually, so the batch failure was not caused by an update. ` +
          `A document observer likely threw; the view may be stale.`,
      );
    }
  }

  async pullRemote(): Promise<void> {
    if (this.destroyed) return;
    if (this.pulling) {
      this.pullQueued = true;
      return;
    }
    this.pulling = true;
    try {
      const fetched = await this.transport.getDocUpdates();
      if (this.destroyed) return;
      const fresh = selectUnseenUpdates(fetched, this.seen, this.poisoned);
      if (fresh.length > 0) this.applyRemote(fresh);
    } finally {
      this.pulling = false;
      if (this.pullQueued && !this.destroyed) {
        this.pullQueued = false;
        void this.pullRemote().catch((e) => {
          // Fire-and-forget follow-up: log rather than leave an unhandled
          // rejection.
          console.error('[CalimeroYjsProvider] queued pullRemote failed', e);
        });
      }
    }
  }

  /**
   * Detach listeners and timers; does not destroy the Y.Doc (the caller owns
   * it). Flushes buffered local updates and awaits any in-flight flush first, so
   * the last keystrokes before unmount aren't dropped. Teardown of
   * listeners/timers is synchronous, so nothing new buffers after this point;
   * the returned promise resolves once the final flush settles.
   */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    // Detach the update listener first so no further edits land in pendingLocal.
    this.doc.off('update', this.handleLocalUpdate);
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Drain directly here (public flush()/drainLoop() stop once destroyed):
    // finish any in-flight loop, then flush whatever's still buffered. Since
    // `destroyed` is set, runFlush re-buffers and throws on the FIRST transport
    // failure (no retry-spin at teardown) — we catch, log that the updates
    // couldn't be persisted, and stop. Never spins, never drops silently.
    try {
      if (this.flushInFlight) {
        await this.flushInFlight.catch(() => {});
      }
      while (this.pendingLocal.length > 0) {
        await this.runFlush();
      }
    } catch (e) {
      console.error(
        '[CalimeroYjsProvider] final flush on destroy failed; ' +
          `${this.pendingLocal.length} buffered update(s) could not be ` +
          'persisted and will be lost',
        e,
      );
    } finally {
      this.awareness.destroy();
    }
  }
}
