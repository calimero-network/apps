/**
 * Pure builders for batch cell operations. A range op (paste/fill/delete/format)
 * is expressed as one CellOp[] and applied by the node in commits of at most
 * MAX_OPS_PER_APPLY ops. The JSON shape mirrors the Rust `CellOp` enum
 * (`#[serde(tag = "kind")]`).
 */

/**
 * The most ops one `apply_cell_ops` call may carry. One node execution has a
 * fixed gas budget that runs out between 500 and 600 cell writes, failing the
 * whole batch. Mirrors `MAX_OPS_PER_APPLY` in the contract, which refuses
 * anything larger with a clear error.
 */
export const MAX_OPS_PER_APPLY = 200;
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

/** Split a batch into slices the node accepts in one commit, order kept. */
export function chunkOps<T>(ops: T[], size = MAX_OPS_PER_APPLY): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < ops.length; i += size) chunks.push(ops.slice(i, i + size));
  return chunks;
}
