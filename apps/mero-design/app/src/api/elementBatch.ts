import { rpcCall } from "./rpc";
import { isVersionSkew } from "../utils/mutationErrors";
import type { Element } from "../types";

/**
 * Writing a selection to the contract in batches.
 *
 * A multi-selection used to be written one element per call. A paste fired every
 * `add_element` at once — 3000 copied shapes were 3000 concurrent requests, and
 * the node answered them with `network error` until the app fell over — and a
 * delete walked the selection one `delete_element` round-trip at a time. The
 * contract now takes a whole batch per call (`add_elements`, `update_elements`,
 * `update_element_labels`, `delete_elements`, `get_elements_by_ids`).
 *
 * A call still runs inside one gas budget, so a selection is sent in chunks,
 * ONE CHUNK AT A TIME: a 3000-element paste is 30 sequential calls, never 3000
 * concurrent ones. A chunk that fails is reported and the rest still go.
 */

/** add / update / label / read: flat cost per element, measured at 300 per call. */
export const WRITE_CHUNK = 100;

/**
 * Deletes cost more the bigger the board is — a storage remove is priced by how
 * many elements the board holds. Measured on merod 0.11.0-rc.43, the most ids
 * one call can delete is ≈ 22 000 / board-size (150 on an empty board, 23 at
 * 1000, 6 at 4000). 15 000 keeps a third in reserve.
 */
export const DELETE_BUDGET = 15_000;
export const DELETE_CHUNK_MAX = 50;

/** How many ids to delete per call from a board this size. */
export function deleteChunkSize(boardSize: number): number {
  return Math.max(1, Math.min(DELETE_CHUNK_MAX, Math.floor(DELETE_BUDGET / Math.max(1, boardSize))));
}

/** A patch as `update_elements` takes it: `update_element`'s arguments, minus `updated_at`. */
export interface ElementPatch {
  id: string;
  x?: number | null;
  y?: number | null;
  width?: number | null;
  height?: number | null;
  rotation?: number | null;
  fill?: string | null;
  stroke?: string | null;
  stroke_width?: number | null;
  opacity?: number | null;
  corner_radius?: number | null;
}

export type OnBatchError = (method: string, error: unknown) => void;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isOutOfGas(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /gas limit/i.test(msg);
}

/**
 * Boards whose contract predates the batch methods, per method.
 *
 * A board runs whatever bundle its context was created or last upgraded with,
 * so a new frontend meets old contracts. Those answer `method "add_elements"
 * not found`; the chunk is then re-sent with the single-element method — one
 * call at a time, never all at once — and the board is remembered so the next
 * batch goes straight there instead of failing first.
 */
const unsupported = new Set<string>();

/** Test seam: forget what was learned about old boards. */
export function resetBatchSupport(): void {
  unsupported.clear();
}

/**
 * Sends `part` with the batch method, or with `single` once per item when this
 * board's contract has no batch method.
 */
async function sendBatch<T>(
  contextId: string,
  method: string,
  batchArgs: Record<string, unknown>,
  part: readonly T[],
  single: (item: T) => Promise<unknown>,
): Promise<void> {
  const key = `${contextId}:${method}`;
  if (!unsupported.has(key)) {
    try {
      await rpcCall(contextId, method, batchArgs);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!isVersionSkew(msg)) throw e;
      unsupported.add(key);
    }
  }
  // Every item goes, even past a failure; the first failure is what gets reported.
  let failure: unknown = null;
  for (const item of part) {
    await single(item).catch((e) => { failure ??= e; });
  }
  if (failure !== null) throw failure;
}

/** Stores every element — new ones and overwrites alike, as `add_element` does. */
export async function addElements(
  contextId: string,
  elements: readonly Element[],
  onError: OnBatchError,
): Promise<void> {
  for (const part of chunk(elements, WRITE_CHUNK)) {
    await sendBatch(contextId, "add_elements", { elements: part }, part,
      (element) => rpcCall(contextId, "add_element", { element }))
      .catch((e) => onError("add_elements", e));
  }
}

/** One edit across many elements; every patch lands with the same `updatedAt`. */
export async function updateElements(
  contextId: string,
  patches: readonly ElementPatch[],
  updatedAt: number,
  onError: OnBatchError,
): Promise<void> {
  for (const part of chunk(patches, WRITE_CHUNK)) {
    await sendBatch(contextId, "update_elements", { patches: part, updated_at: updatedAt }, part,
      (patch) => rpcCall(contextId, "update_element", {
        x: null, y: null, width: null, height: null, rotation: null,
        fill: null, stroke: null, stroke_width: null, opacity: null, corner_radius: null,
        ...patch,
        updated_at: updatedAt,
      }))
      .catch((e) => onError("update_elements", e));
  }
}

/** Grouping, ungrouping, a group rename — every label in as few calls as fit. */
export async function updateElementLabels(
  contextId: string,
  labels: Readonly<Record<string, string | null>>,
  updatedAt: number,
  onError: OnBatchError,
): Promise<void> {
  const entries = Object.entries(labels).map(([id, label]) => ({ id, label }));
  for (const part of chunk(entries, WRITE_CHUNK)) {
    await sendBatch(contextId, "update_element_labels", { labels: part, updated_at: updatedAt }, part,
      ({ id, label }) => rpcCall(contextId, "update_element_label", { id, label, updated_at: updatedAt }))
      .catch((e) => onError("update_element_labels", e));
  }
}

/**
 * Deletes every id, in chunks sized from the board: `boardSize` is how many
 * elements the board held BEFORE the delete, and each chunk shrinks it.
 *
 * A chunk that still runs out of gas — a peer grew the board meanwhile — is
 * halved and retried, down to one id per call. Any other failure is reported
 * and the next chunk goes on.
 */
export async function deleteElements(
  contextId: string,
  ids: readonly string[],
  boardSize: number,
  onError: OnBatchError,
): Promise<void> {
  let remaining = [...ids];
  let size = Math.max(boardSize, ids.length);
  let cap = DELETE_CHUNK_MAX;
  while (remaining.length > 0) {
    const n = Math.min(cap, deleteChunkSize(size), remaining.length);
    const part = remaining.slice(0, n);
    try {
      await sendBatch(contextId, "delete_elements", { ids: part }, part,
        (id) => rpcCall(contextId, "delete_element", { id }));
    } catch (e) {
      if (isOutOfGas(e) && n > 1) {
        cap = Math.max(1, Math.floor(n / 2));
        continue;
      }
      onError("delete_elements", e);
    }
    remaining = remaining.slice(n);
    size = Math.max(1, size - n);
  }
}

/** The current copy of every id that still exists, in one read per chunk. */
export async function getElementsByIds(
  contextId: string,
  ids: readonly string[],
): Promise<Element[]> {
  const key = `${contextId}:get_elements_by_ids`;
  const out: Element[] = [];
  for (const part of chunk(ids, WRITE_CHUNK)) {
    if (!unsupported.has(key)) {
      try {
        const got = await rpcCall<Element[] | null>(contextId, "get_elements_by_ids", { ids: part });
        if (Array.isArray(got)) out.push(...got);
        continue;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!isVersionSkew(msg)) throw e;
        unsupported.add(key);
      }
    }
    // An older board: one full read answers every id at once.
    const all = await rpcCall<Element[] | null>(contextId, "get_elements", {});
    const wanted = new Set(ids);
    return (Array.isArray(all) ? all : []).filter((el) => wanted.has(el.id));
  }
  return out;
}
