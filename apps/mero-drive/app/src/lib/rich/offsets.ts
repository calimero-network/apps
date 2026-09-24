// Core positions index Unicode scalar values; every JS string index is a UTF-16
// code unit. An index inside a surrogate pair names no scalar, so it throws;
// an index outside the string clamps, because a remote position legitimately
// outruns a locally edited string.

/** Number of Unicode scalar values in `text`. */
export function scalarLength(text: string): number {
  return Array.from(text).length;
}

const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** UTF-16 code unit index to scalar index. */
export function utf16ToScalar(text: string, index: number): number {
  if (index <= 0) return 0;
  if (index >= text.length) return scalarLength(text);
  if (isHigh(text.charCodeAt(index - 1)) && isLow(text.charCodeAt(index))) {
    throw new RangeError(`UTF-16 index ${index} falls inside a surrogate pair`);
  }
  return Array.from(text.slice(0, index)).length;
}

/** Scalar index to UTF-16 code unit index. */
export function scalarToUtf16(text: string, index: number): number {
  return index <= 0 ? 0 : Array.from(text).slice(0, index).join('').length;
}
