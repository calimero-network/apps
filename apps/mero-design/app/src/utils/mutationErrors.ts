/**
 * Why edits vanish silently.
 *
 * Every contract mutation in this app is fired as `rpcCall(...).catch(() => {})`.
 * `rpcCall` throws a useful message; the call sites throw it away. The local store
 * is already updated by then, so the UI looks correct until the next sync from the
 * contract quietly replaces it — the edit is simply gone, with nothing on screen
 * having said so.
 *
 * The sharpest case is version skew. A board whose context still runs an older
 * bundle has no `set_layer_index` and no `corner_radius` argument, so those calls
 * fail every time and layer moves and corner radii never persist. That is
 * indistinguishable from a UI bug, and it is exactly what shipped.
 *
 * This turns a discarded rejection into one legible message, deduplicated so a
 * stale board reports once instead of on every keystroke.
 */

/** A missing method or an unexpected argument — i.e. the contract is older than the UI. */
export function isVersionSkew(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("method not found") ||
    m.includes("unknown method") ||
    m.includes("no method") ||
    m.includes("unknown field") ||
    m.includes("missing field") ||
    m.includes("invalid type") ||
    m.includes("deserialize")
  );
}

const SKEW_MESSAGE =
  "This board runs an older version of the app, so that change could not be saved. Reopen it after the board is updated.";

export function describeMutationFailure(method: string, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (isVersionSkew(raw)) return SKEW_MESSAGE;
  const detail = raw.trim().slice(0, 160);
  return detail ? `Could not save (${method}): ${detail}` : `Could not save (${method}).`;
}

/**
 * Reports each distinct failure once per window. A board that is behind fails on
 * every drag; one message is information, twenty is noise.
 */
export function createMutationReporter(
  report: (message: string) => void,
  windowMs = 15_000,
  now: () => number = () => Date.now(),
) {
  const lastSeen = new Map<string, number>();
  return function onMutationFailed(method: string, err: unknown): void {
    const message = describeMutationFailure(method, err);
    const previous = lastSeen.get(message);
    const t = now();
    if (previous !== undefined && t - previous < windowMs) return;
    lastSeen.set(message, t);
    report(message);
  };
}
