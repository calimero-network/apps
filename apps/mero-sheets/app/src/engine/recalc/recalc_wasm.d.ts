/* tslint:disable */
/* eslint-disable */

/**
 * What a value must be to meet a condition, in words.
 */
export function condition_describe(condition: string, args: string): string;

/**
 * Whether `value` meets a rule's condition (`args` a JSON array of strings):
 * the same test the contract applies to a strict validation.
 */
export function condition_matches(condition: string, args: string, value: string): boolean;

/**
 * Browser entry point for [`evaluate_json`].
 */
export function evaluate(input: string): string;

/**
 * Browser entry point for [`functions_json`].
 */
export function functions(): string;

/**
 * Browser entry point for [`set_structure_json`].
 */
export function set_structure(input: string): boolean;

/**
 * A formula as stored (ids) → as shown (positions), on sheet `home`.
 */
export function to_display(formula_text: string, home: string): string;

/**
 * A formula as typed (positions) → as stored (ids), on sheet `home`.
 */
export function to_stored(formula_text: string, home: string): string;

/**
 * Browser entry point for [`visible_order_json`].
 */
export function visible_order(sheet_id: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly condition_describe: (a: number, b: number, c: number, d: number) => [number, number];
    readonly condition_matches: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly evaluate: (a: number, b: number) => [number, number];
    readonly functions: () => [number, number];
    readonly set_structure: (a: number, b: number) => number;
    readonly to_display: (a: number, b: number, c: number, d: number) => [number, number];
    readonly to_stored: (a: number, b: number, c: number, d: number) => [number, number];
    readonly visible_order: (a: number, b: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
