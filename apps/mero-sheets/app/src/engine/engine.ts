// Lazy loader for the committed wasm-pack (--target web) recalc engine.
import type { FunctionDef, NamedRange, SheetLayout } from '../api/spreadsheet/SpreadsheetClient';
import type { Order } from './derive';
import init, {
  evaluate as wasmEvaluate,
  functions as wasmFunctions,
  set_structure as wasmSetStructure,
  to_display as wasmToDisplay,
  to_stored as wasmToStored,
  visible_order as wasmVisibleOrder,
} from './recalc/recalc_wasm.js';

let ready = false;
let initPromise: Promise<void> | null = null;

export function initEngine(): Promise<void> {
  if (ready) return Promise.resolve();
  if (!initPromise) {
    initPromise = init().then(() => {
      ready = true;
      applyStructure();
    });
  }
  return initPromise;
}

export function engineReady(): boolean {
  return ready;
}

/** Synchronous once initEngine() has resolved. Throws otherwise. */
export function evaluate(inputJson: string): string {
  if (!ready) throw new Error('recalc engine not initialized — await initEngine() first');
  return wasmEvaluate(inputJson);
}

/**
 * Every function the engine implements, from the engine itself — the same
 * catalog the contract's `get_functions` serves. Empty until initEngine()
 * has resolved.
 */
export function functionCatalog(): FunctionDef[] {
  return ready ? (JSON.parse(wasmFunctions()) as FunctionDef[]) : [];
}

// ── Workbook structure ───────────────────────────────────────────────────────
//
// Row/column order and named ranges live in the engine, so the grid places a
// cell, and a formula converts between display and stored form, by the same
// code the node evaluates with. Kept here as well so a structure set before
// the engine loads is applied when it does.

let structure = '{}';
const orders = new Map<string, Order>();

/** Rows and columns a sheet has before any structural edit (MAX_ROWS/MAX_COLS). */
const LEGACY_ROWS = 1000;
const LEGACY_COLS = 702;

function applyStructure() {
  orders.clear();
  if (ready) wasmSetStructure(structure);
}

/** Replace the workbook structure: every sheet's layout and the named ranges. */
export function setStructure(layouts: SheetLayout[], names: NamedRange[]): void {
  structure = JSON.stringify({ layouts, names });
  applyStructure();
}

/**
 * A sheet's visible order: the row id and column id at each position. Before
 * the engine loads, the legacy layout (id `k` at position `k`).
 */
export function visibleOrder(sheetId: string): Order {
  const cached = orders.get(sheetId);
  if (cached) return cached;
  if (!ready) {
    return {
      rows: Array.from({ length: LEGACY_ROWS }, (_, i) => String(i)),
      cols: Array.from({ length: LEGACY_COLS }, (_, i) => String(i)),
    };
  }
  const order = JSON.parse(wasmVisibleOrder(sheetId)) as Order;
  orders.set(sheetId, order);
  return order;
}

/** A formula as typed (positions) → as stored (ids), on sheet `home`. */
export function toStored(formula: string, home: string): string {
  return ready && formula.startsWith('=') ? wasmToStored(formula, home) : formula;
}

/** A formula as stored (ids) → as shown (positions), on sheet `home`. */
export function toDisplay(formula: string, home: string): string {
  return ready && formula.startsWith('=') ? wasmToDisplay(formula, home) : formula;
}
