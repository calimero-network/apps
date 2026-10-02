/**
 * Ask for something a node may not hold yet, for as long as it is reasonably
 * still catching up.
 *
 * ⚠️ A FIRST "NOT FOUND" IS NOT AN ANSWER. A document a peer uploaded a moment
 * ago, or any document right after this node restarted, is listed (the
 * agreement's state syncs first) before the node has fetched its bytes from a
 * peer. Failing on the first refusal showed "could not load" for a document
 * that would open a second later — every time on a slow runner, and to anyone
 * who opens a document the instant it appears. So the call is repeated with a
 * growing delay until it answers or the window closes, and only then is the
 * last error the caller's.
 *
 * An error carrying `permanent: true` (nothing to fetch at all) is not retried.
 */
export interface FetchWhileSyncingOptions {
  /** How long to keep asking, from the first call. */
  readonly windowMs?: number;
  readonly firstDelayMs?: number;
  readonly maxDelayMs?: number;
  /** Stop asking (and reject with the last error) once this returns true. */
  readonly cancelled?: () => boolean;
}

export async function fetchWhileSyncing<T>(
  fetch: () => Promise<T>,
  {
    windowMs = 30_000,
    firstDelayMs = 500,
    maxDelayMs = 4_000,
    cancelled = () => false,
  }: FetchWhileSyncingOptions = {},
): Promise<T> {
  const deadline = Date.now() + windowMs;
  let delay = firstDelayMs;
  for (;;) {
    let last: unknown;
    try {
      return await fetch();
    } catch (e) {
      if ((e as { permanent?: boolean })?.permanent) throw e;
      if (cancelled() || Date.now() + delay > deadline) throw e;
      last = e;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (cancelled()) throw last;
    delay = Math.min(delay * 2, maxDelayMs);
  }
}
