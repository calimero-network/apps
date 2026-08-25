/**
 * Fixed-decimal formatting for a metric that may not have a value yet.
 *
 * Returns `undefined` — not `"0"` and not `"NaN"` — for absent or non-finite
 * input, so a panel can render an em-dash. That distinction is load-bearing in
 * this app: several probe values are legitimately null (no latency sample until a
 * remote frame arrives; `seqGaps` is null with two or more remote senders because
 * a span-based count is fiction there), and printing `0` for "not measured yet"
 * is a lie a reader cannot detect.
 */
export function fmt(
  value: number | null | undefined,
  digits: number,
): string | undefined {
  if (value === null || value === undefined || !Number.isFinite(value))
    return undefined;
  return value.toFixed(digits);
}
