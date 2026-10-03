/**
 * Retrying the room join until the context is ready to take it.
 *
 * Entering a room the joining node has only just learned about races the
 * context's first sync: the node subscribes, then snapshot-syncs the room's
 * state from a peer, and until that lands every execute is refused with core's
 * `Uninitialized` ("context state not initialized, awaiting state sync"). A
 * snapshot that loses a race with a concurrent write is retried by core after a
 * 2s backoff, so the window is routinely seconds, not milliseconds.
 *
 * `useExecute` swallows the error and resolves `null`, so the call page sees a
 * failed join as `null` — and used to try exactly once, leaving the page on
 * "joining…" forever (the go-live button disabled with it) even though the
 * context synced a moment later.
 */

/** Waits between attempts; the last one repeats until the deadline. */
export const JOIN_RETRY_DELAYS_MS = [500, 1_000, 2_000, 3_000, 5_000];

/**
 * How long to keep trying. Well past a slow-but-healthy first sync (core's own
 * backoff included); a context that has not initialised by then is a real fault
 * and the page should stop hammering it.
 */
export const JOIN_DEADLINE_MS = 120_000;

export interface RetryOptions {
  deadlineMs: number;
  /** Checked before and after every attempt; true aborts with `null`. */
  isCancelled: () => boolean;
  delaysMs?: number[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Call `attempt` until it resolves a non-null value, backing off between tries.
 * Resolves `null` on cancellation or once the deadline would be passed.
 */
export async function retryUntilValue<T>(
  attempt: () => Promise<T | null | undefined>,
  {
    deadlineMs,
    isCancelled,
    delaysMs = JOIN_RETRY_DELAYS_MS,
    now = Date.now,
    sleep = realSleep,
  }: RetryOptions,
): Promise<T | null> {
  const start = now();
  for (let i = 0; ; i++) {
    if (isCancelled()) return null;
    const value = await attempt();
    if (isCancelled()) return null;
    if (value != null) return value;
    const delay = delaysMs[Math.min(i, delaysMs.length - 1)];
    if (now() - start + delay > deadlineMs) return null;
    await sleep(delay);
  }
}
