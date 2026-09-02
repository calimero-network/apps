// ── Bounded-concurrency map ──────────────────────────────────────────────────

/**
 * Run `fn` over `items` with at most `limit` in flight, preserving input order in
 * the result.
 *
 * Written for the showcase loader: ~30 layers each needing a PNG encode and two
 * round-trips. Strictly sequential, that is seconds of dead time; unbounded, it
 * is 60 simultaneous uploads at one node. Neither is what you want from one click.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  if (items.length === 0) return out;
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  };

  // Promise.all rejects on the first failure, and the remaining workers stop at
  // their next iteration — a failed upload aborts the load rather than leaving a
  // half-written document with no error.
  await Promise.all(Array.from({ length: width }, worker));
  return out;
}
