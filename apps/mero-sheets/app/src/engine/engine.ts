// Lazy loader for the committed wasm-pack (--target web) recalc engine.
import type { FunctionDef } from '../api/spreadsheet/SpreadsheetClient';
import init, { evaluate as wasmEvaluate, functions as wasmFunctions } from './recalc/recalc_wasm.js';

let ready = false;
let initPromise: Promise<void> | null = null;

export function initEngine(): Promise<void> {
  if (ready) return Promise.resolve();
  if (!initPromise) {
    initPromise = init().then(() => {
      ready = true;
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
