// Lazy loader for the committed wasm-pack (--target web) recalc engine.
import init, { evaluate as wasmEvaluate } from './recalc/recalc_wasm.js';

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
