/**
 * Continue a fill pattern from the source values for `count` more cells.
 * Numeric-arithmetic only in v1: a single value copies verbatim; 2+ numeric
 * values with a constant step extend the sequence; anything else repeats the
 * source cyclically. Pure.
 */
function trimNum(n: number): string {
  // Avoid float noise (0.1+0.2) while keeping integers/short decimals clean.
  return String(Number(n.toPrecision(12)));
}

export function fillSeries(sourceValues: string[], count: number): string[] {
  if (count <= 0) return [];
  const numeric =
    sourceValues.length >= 2 &&
    sourceValues.every((v) => v.trim() !== '' && Number.isFinite(Number(v)));
  if (numeric) {
    const nums = sourceValues.map(Number);
    const step = nums[1] - nums[0];
    const constant = nums.every((n, i) => i === 0 || n - nums[i - 1] === step);
    if (constant) {
      const out: string[] = [];
      let val = nums[nums.length - 1];
      for (let i = 0; i < count; i++) {
        val += step;
        out.push(trimNum(val));
      }
      return out;
    }
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(sourceValues[i % sourceValues.length]);
  return out;
}
