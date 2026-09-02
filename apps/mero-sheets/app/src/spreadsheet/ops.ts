/**
 * Pure builders for batch cell operations. A range op (paste/fill/delete/format)
 * is expressed as one CellOp[] and applied by the node in a single commit.
 * The JSON shape mirrors the Rust `CellOp` enum (`#[serde(tag = "kind")]`).
 */
export type CellOp =
  | { kind: 'Set'; row: number; col: number; raw_value: string }
  | { kind: 'Format'; row: number; col: number; format: string }
  | { kind: 'Clear'; row: number; col: number };

export const setOp = (row: number, col: number, raw_value: string): CellOp => ({
  kind: 'Set', row, col, raw_value,
});
export const formatOp = (row: number, col: number, format: string): CellOp => ({
  kind: 'Format', row, col, format,
});
export const clearOp = (row: number, col: number): CellOp => ({ kind: 'Clear', row, col });

/** One Set per write, plus a Format op when the write carries a non-empty format. */
export function opsFromWrites(
  writes: { row: number; col: number; raw: string; format: string }[],
): CellOp[] {
  const ops: CellOp[] = [];
  for (const w of writes) {
    ops.push(setOp(w.row, w.col, w.raw));
    if (w.format) ops.push(formatOp(w.row, w.col, w.format));
  }
  return ops;
}
