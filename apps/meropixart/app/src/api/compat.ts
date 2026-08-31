// ── Contract compatibility ───────────────────────────────────────────────────
//
// Nodes update independently. A peer (or your own node) can be running an app
// build that predates a method this frontend calls, and the runtime answers with
//
//   method "move_layers" not found
//
// …which surfaced as grouping simply failing. In a p2p app that is not an edge
// case: the installed WASM is pinned per context, so a document created before an
// upgrade keeps the old contract for its whole life.
//
// So every method added after the first release is called through
// {@link rpcWithFallback}, which falls back to the older method that does the
// same job. The verdict is remembered per method name, so a document on an old
// contract pays the failed call once, not once per action.

/** True when the node rejected the call because the WASM has no such export. */
export function isMethodNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  // calimero-runtime: `#[error("method {name:?} not found")]`
  return /method\s+.*not found/i.test(msg);
}

/** Method names this context's contract has already told us it lacks. */
const missing = new Set<string>();

/** True once `name` has answered "not found" on this page load. */
export function isMethodKnownMissing(name: string): boolean {
  return missing.has(name);
}

/** Forget the verdicts — used when switching documents, and by tests. */
export function resetMethodSupport(): void {
  missing.clear();
}

/**
 * Call `primary`; if the contract does not have that method, call `fallback`
 * instead and remember not to try again.
 *
 * `onFallback` fires the FIRST time a method turns out to be missing, so the UI
 * can say once that this document is on an older app build rather than staying
 * silent about a degraded path.
 *
 * Any other error propagates — a permission denial or a borsh mismatch must not
 * be silently retried down a different path.
 */
export async function rpcWithFallback<T>(
  name: string,
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  onFallback?: (name: string) => void,
): Promise<T> {
  if (missing.has(name)) return fallback();
  try {
    return await primary();
  } catch (err) {
    if (!isMethodNotFoundError(err)) throw err;
    missing.add(name);
    onFallback?.(name);
    return fallback();
  }
}
