import type { Cell } from '../api/spreadsheet/SpreadsheetClient';

export type OverlayEntry = {
  sheet_id: string;
  row: number;
  col: number;
  raw_value: string; // '' means cleared value
  format: string;    // '' means no/removed format
};
export type Overlay = Map<string, OverlayEntry>;
export type Snapshot = Map<string, Cell>;

export function cellKey(sheetId: string, row: number, col: number): string {
  return `${sheetId}|${row}|${col}`;
}

export function snapshotFromCells(cells: Cell[]): Snapshot {
  const m: Snapshot = new Map();
  for (const c of cells) m.set(cellKey(c.sheet_id, c.row, c.col), c);
  return m;
}

// The effective raw/format at a key: overlay wins over snapshot.
function effective(
  key: string,
  snapshot: Snapshot,
  overlay: Overlay,
): { sheet_id: string; row: number; col: number; raw_value: string; format: string } | null {
  const o = overlay.get(key);
  const s = snapshot.get(key);
  if (o) return { sheet_id: o.sheet_id, row: o.row, col: o.col, raw_value: o.raw_value, format: o.format };
  if (s) return { sheet_id: s.sheet_id, row: s.row, col: s.col, raw_value: s.raw_value, format: s.format };
  return null;
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

/** Engine input JSON for `snapshot ⊕ overlay`: every effective non-blank cell. */
export function buildEngineInput(snapshot: Snapshot, overlay: Overlay, sheetIds: string[]): string {
  const cells: { sheet_id: string; row: number; col: number; raw_value: string }[] = [];
  for (const key of unionKeys(snapshot, overlay)) {
    const e = effective(key, snapshot, overlay);
    if (!e || e.raw_value === '') continue; // blank cells are absent to the engine
    cells.push({ sheet_id: e.sheet_id, row: e.row, col: e.col, raw_value: e.raw_value });
  }
  return JSON.stringify({ cells, sheet_ids: sheetIds });
}

/**
 * Active-sheet cells with engine-computed values (overlay applied). Mirrors the
 * node's get_cells output filter: a fully-blank cell (no value AND no format) is
 * hidden; a formatted-but-empty cell is kept.
 */
export function deriveActiveCells(
  snapshot: Snapshot,
  overlay: Overlay,
  sheetIds: string[],
  activeSheetId: string,
  evaluate: (json: string) => string,
): Cell[] {
  const computed = new Map<string, string>();
  const outputs = JSON.parse(evaluate(buildEngineInput(snapshot, overlay, sheetIds))) as {
    sheet_id: string; row: number; col: number; computed_value: string;
  }[];
  for (const o of outputs) computed.set(cellKey(o.sheet_id, o.row, o.col), o.computed_value);

  const out: Cell[] = [];
  for (const key of unionKeys(snapshot, overlay)) {
    const e = effective(key, snapshot, overlay);
    if (!e || e.sheet_id !== activeSheetId) continue;
    if (e.raw_value === '' && e.format === '') continue; // fully blank → hidden
    const base = snapshot.get(key);
    out.push({
      id: base?.id ?? key,
      sheet_id: e.sheet_id,
      row: e.row,
      col: e.col,
      raw_value: e.raw_value,
      computed_value: computed.get(key) ?? e.raw_value,
      format: e.format,
      updated_at: base?.updated_at ?? 0,
    });
  }
  out.sort((a, b) => a.row - b.row || a.col - b.col);
  return out;
}

/** Dev-assert helper: keys where node-computed and WASM-derived values disagree. */
export function diffComputed(nodeActive: Cell[], derivedActive: Cell[]): string[] {
  const derived = new Map<string, string>();
  for (const c of derivedActive) derived.set(cellKey(c.sheet_id, c.row, c.col), c.computed_value);
  const bad: string[] = [];
  for (const c of nodeActive) {
    const k = cellKey(c.sheet_id, c.row, c.col);
    if (derived.has(k) && derived.get(k) !== c.computed_value) bad.push(k);
  }
  return bad;
}
