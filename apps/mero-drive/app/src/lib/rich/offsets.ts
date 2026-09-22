// Core positions index Unicode scalar values; every JS string index is a UTF-16
// code unit. An index inside a surrogate pair names no scalar, so it throws;
// an index outside the string clamps, because a remote position legitimately
// outruns a locally edited string.

/** Number of Unicode scalar values in `text`. */
export function scalarLength(text: string): number {
  return Array.from(text).length;
}

/** Per UTF-16 index, the scalar index at that gap, or -1 mid-surrogate. */
function prefixMap(text: string): number[] {
  const map = new Array<number>(text.length + 1).fill(-1);
  let unit = 0;
  let scalar = 0;
  for (const codePoint of text) {
    map[unit] = scalar;
    unit += codePoint.length;
    scalar += 1;
  }
  map[unit] = scalar;
  return map;
}

/** UTF-16 code unit index to scalar index. */
export function utf16ToScalar(text: string, index: number): number {
  if (index <= 0) return 0;
  if (index >= text.length) return scalarLength(text);
  const scalar = prefixMap(text)[index];
  if (scalar < 0) {
    throw new RangeError(`UTF-16 index ${index} falls inside a surrogate pair`);
  }
  return scalar;
}

/** Scalar index to UTF-16 code unit index. */
export function scalarToUtf16(text: string, index: number): number {
  if (index <= 0) return 0;
  const codePoints = Array.from(text);
  if (index >= codePoints.length) return text.length;
  let unit = 0;
  for (let i = 0; i < index; i++) unit += codePoints[i].length;
  return unit;
}

/** A UTF-16 range as an ordered scalar range. */
export function utf16RangeToScalar(
  text: string,
  start: number,
  end: number,
): [number, number] {
  const a = utf16ToScalar(text, start);
  const b = utf16ToScalar(text, end);
  return a <= b ? [a, b] : [b, a];
}

/** A scalar range as an ordered UTF-16 range. */
export function scalarRangeToUtf16(
  text: string,
  start: number,
  end: number,
): [number, number] {
  const a = scalarToUtf16(text, start);
  const b = scalarToUtf16(text, end);
  return a <= b ? [a, b] : [b, a];
}
