import type { Cell as StoredCell } from '../api/spreadsheet/SpreadsheetClient';

/**
 * A cell as the grid sees it: placed at a position by its sheet's layout, with
 * its raw value in display form (references by position). Stored cells name
 * rows and columns by id and store formulas by id; this is the one place the
 * two meet.
 */
export interface GridCell {
  id: string;
  sheet_id: string;
  /** Position in the sheet's current row/column order. */
  row: number;
  col: number;
  row_id: string;
  col_id: string;
  /** Display form: what the formula bar shows and what the user edits. */
  raw_value: string;
  computed_value: string;
  format: string;
  updated_at: number;
}

export type OverlayEntry = {
  sheet_id: string;
  row_id: string;
  col_id: string;
  raw_value: string; // stored form; '' means cleared value
  format: string;    // '' means no/removed format
};
export type Overlay = Map<string, OverlayEntry>;
export type Snapshot = Map<string, StoredCell>;

/** A sheet's visible order: the id at each row and column position. */
export interface Order {
  rows: string[];
  cols: string[];
}

/** The same key the contract stores a cell under. */
export function cellKey(sheetId: string, rowId: string, colId: string): string {
  return `${sheetId}|${rowId}|${colId}`;
}

export function snapshotFromCells(cells: StoredCell[]): Snapshot {
  const m: Snapshot = new Map();
  for (const c of cells) m.set(cellKey(c.sheet_id, c.row_id, c.col_id), c);
  return m;
}

type Effective = { sheet_id: string; row_id: string; col_id: string; raw_value: string; format: string };

// The effective raw/format at a key: overlay wins over snapshot.
function effective(key: string, snapshot: Snapshot, overlay: Overlay): Effective | null {
  const o = overlay.get(key);
  if (o) return o;
  const s = snapshot.get(key);
  return s ? { sheet_id: s.sheet_id, row_id: s.row_id, col_id: s.col_id, raw_value: s.raw_value, format: s.format } : null;
}

// All keys present in either map (union), so overlay-only new cells are included.
function unionKeys(snapshot: Snapshot, overlay: Overlay): string[] {
  const set = new Set<string>();
  for (const k of snapshot.keys()) set.add(k);
  for (const k of overlay.keys()) set.add(k);
  return [...set];
}

/**
 * Drop overlay entries the snapshot has caught up to. An entry is confirmed when
 * the snapshot's raw value for that key equals the overlay's (a persisted edit),
 * or the overlay is a clear ('') and the snapshot has no cell there (persisted
 * clear). In-flight entries — snapshot still shows the old/absent value — survive.
 */
export function retireOverlay(overlay: Overlay, snapshot: Snapshot): Overlay {
  const next: Overlay = new Map();
  for (const [key, entry] of overlay) {
    const s = snapshot.get(key);
    const confirmedWrite = s !== undefined && s.raw_value === entry.raw_value && s.format === entry.format;
    const confirmedClear = entry.raw_value === '' && entry.format === '' && s === undefined;
    if (confirmedWrite || confirmedClear) continue; // retired
    next.set(key, entry);
  }
  return next;
}

/**
 * Engine input JSON for `snapshot ⊕ overlay`: every effective non-blank cell,
 * by id. `sheetIds` is the full sheet set, passed through so the engine can
 * tell an unknown-sheet reference (→ #REF!) from a known-but-empty one.
 */
export function buildEngineInput(
  snapshot: Snapshot,
  overlay: Overlay,
  sheetIds: string[],
  nowMs: number = Date.now(),
): string {
  const cells: { sheet_id: string; row_id: string; col_id: string; raw_value: string }[] = [];
  for (const key of unionKeys(snapshot, overlay)) {
    const e = effective(key, snapshot, overlay);
    if (!e || e.raw_value === '') continue; // blank cells are absent to the engine
    cells.push({ sheet_id: e.sheet_id, row_id: e.row_id, col_id: e.col_id, raw_value: e.raw_value });
  }
  return JSON.stringify({ cells, sheet_ids: sheetIds, now_ms: nowMs });
}

/** Everything placing a sheet's cells needs from the engine. */
export interface Placement {
  order: Order;
  /** Stored formula → display form, on the sheet being placed. */
  toDisplay: (stored: string) => string;
}

/**
 * One sheet's cells with engine-computed values (overlay applied), placed by
 * the sheet's order. A cell whose row or column is deleted (or past the grid)
 * is not placed. Mirrors the node's get_cells filter: a fully-blank cell (no
 * value AND no format) is hidden; a formatted-but-empty one is kept.
 */
export function deriveSheetCells(
  snapshot: Snapshot,
  overlay: Overlay,
  sheetIds: string[],
  sheetId: string,
  evaluate: (json: string) => string,
  place: Placement,
): GridCell[] {
  const computed = new Map<string, string>();
  const outputs = JSON.parse(evaluate(buildEngineInput(snapshot, overlay, sheetIds))) as {
    sheet_id: string; row_id: string; col_id: string; computed_value: string;
  }[];
  for (const o of outputs) computed.set(cellKey(o.sheet_id, o.row_id, o.col_id), o.computed_value);
  const rowAt = new Map(place.order.rows.map((id, i) => [id, i]));
  const colAt = new Map(place.order.cols.map((id, i) => [id, i]));

  const out: GridCell[] = [];
  for (const key of unionKeys(snapshot, overlay)) {
    const e = effective(key, snapshot, overlay);
    if (!e || e.sheet_id !== sheetId) continue;
    if (e.raw_value === '' && e.format === '') continue; // fully blank → hidden
    const row = rowAt.get(e.row_id);
    const col = colAt.get(e.col_id);
    if (row === undefined || col === undefined) continue;
    const base = snapshot.get(key);
    out.push({
      id: base?.id ?? key,
      sheet_id: e.sheet_id,
      row,
      col,
      row_id: e.row_id,
      col_id: e.col_id,
      raw_value: e.raw_value.startsWith('=') ? place.toDisplay(e.raw_value) : e.raw_value,
      computed_value: computed.get(key) ?? e.raw_value,
      format: e.format,
      updated_at: base?.updated_at ?? 0,
    });
  }
  out.sort((a, b) => a.row - b.row || a.col - b.col);
  return out;
}

/**
 * Dev-assert helper: keys where node-computed and WASM-derived values disagree,
 * INCLUDING a node cell that has no corresponding derived cell at all (it
 * dropped out of derivation) — a missing key is as much a divergence as a
 * disagreeing value. `node` holds the snapshot's cells for the sheet, `derived`
 * what `deriveSheetCells` placed with `order`.
 */
export function diffComputed(node: StoredCell[], derived: GridCell[], order: Order): string[] {
  const got = new Map<string, string>();
  for (const c of derived) got.set(cellKey(c.sheet_id, c.row_id, c.col_id), c.computed_value);
  const rows = new Set(order.rows);
  const cols = new Set(order.cols);
  const bad: string[] = [];
  for (const c of node) {
    // NOW()/TODAY() read each side's own clock, so they differ by design.
    if (/\b(NOW|TODAY)\s*\(/i.test(c.raw_value)) continue;
    // A cell in a deleted row or column is stored but never placed.
    if (!rows.has(c.row_id) || !cols.has(c.col_id)) continue;
    const k = cellKey(c.sheet_id, c.row_id, c.col_id);
    if (!got.has(k) || got.get(k) !== c.computed_value) bad.push(k);
  }
  return bad;
}
