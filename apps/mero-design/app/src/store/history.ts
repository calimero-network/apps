import type { Element } from "../types";

/**
 * Undo history for a shared board.
 *
 * An entry is what ONE local action did, element by element: the element as it
 * was before the action first touched it, and as the action left it. `null`
 * stands for "not on the board", so a create is `before: null` and a delete is
 * `after: null`.
 *
 * Undo used to swap in a copy of the whole board taken before the action. On a
 * board several people edit at once that copy also held everyone else's work as
 * it stood then, so an undo threw away whatever teammates had done since — and
 * it only ever changed this tab's store, never the node, so the next sync put
 * the undone edit straight back.
 *
 * Replaying an entry instead touches only the elements this user changed, and
 * only the fields the action changed on them: a teammate who recoloured a shape
 * keeps their colour when this user undoes moving it.
 */
export interface Change {
  before: Element | null;
  after: Element | null;
}

export interface HistoryEntry {
  /** By element id. */
  changes: Record<string, Change>;
  /** When the entry last took a change, unix milliseconds. */
  at: number;
}

/** What replaying an entry writes: whole elements to store, and ids to delete. */
export interface HistoryPlan {
  upserts: Element[];
  deletes: string[];
}

/**
 * Changes this close together, with no `snapshot()` between them, are one step:
 * a slider dragged through forty values, or an action that writes in two passes.
 */
export const COALESCE_MS = 600;

/** Bookkeeping the contract owns; never part of what an action changed. */
const UNTRACKED = new Set<keyof Element>(["updatedAt", "createdAt", "createdBy"]);

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The fields `from` and `to` disagree on, bookkeeping aside. */
export function changedFields(from: Element, to: Element): (keyof Element)[] {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)] as (keyof Element)[]);
  return [...keys].filter((k) => !UNTRACKED.has(k) && !same(from[k], to[k]));
}

/**
 * `entry` with each `[before, after]` folded in. The first change to an element
 * in an entry fixes its `before`; later ones only move its `after`.
 *
 * One copy of `changes` for the whole batch, then written in place: copying it
 * per element made a batch of n elements cost n² (3,000 pasted shapes took
 * seconds).
 */
export function record(
  entry: HistoryEntry,
  edits: Iterable<readonly [before: Element | null, after: Element | null]>,
  at: number,
): HistoryEntry {
  const changes = { ...entry.changes };
  for (const [before, after] of edits) {
    const id = (after ?? before)?.id;
    if (!id) continue;
    const prior = changes[id];
    changes[id] = { before: prior ? prior.before : before, after };
  }
  return { changes, at };
}

/** True when replaying the entry would change nothing (e.g. a shape drawn then deleted). */
export function isEmpty(entry: HistoryEntry): boolean {
  return Object.values(entry.changes).every(({ before, after }) =>
    before === null ? after === null : after !== null && changedFields(before, after).length === 0);
}

/**
 * Take the board from each change's `from` side back to its `to` side, applied
 * to the board as it is NOW. Undo is `plan(entry, "before", ...)`, redo is
 * `plan(entry, "after", ...)`.
 *
 * - The action created it (target `null`): delete it, if it is still there.
 * - The action deleted it (source `null`): put it back, unless something with
 *   that id is already there again.
 * - The action changed it: write the action's fields back over the current copy,
 *   leaving every other field — a teammate's edit included — as it is now. An
 *   element a teammate has since deleted stays deleted.
 *
 * Every write carries `now` as its `updatedAt`, so it wins the contract's
 * last-writer-wins merge against the edit it reverts.
 */
export function plan(
  entry: HistoryEntry,
  target: "before" | "after",
  current: readonly Element[],
  now: number,
): HistoryPlan {
  const source = target === "before" ? "after" : "before";
  const byId = new Map(current.map((e) => [e.id, e] as const));
  const out: HistoryPlan = { upserts: [], deletes: [] };
  for (const [id, change] of Object.entries(entry.changes)) {
    const want = change[target];
    const had = change[source];
    const live = byId.get(id);
    if (want === null) {
      if (had !== null && live) out.deletes.push(id);
      continue;
    }
    if (had === null) {
      if (!live) out.upserts.push({ ...want, updatedAt: now });
      continue;
    }
    if (!live) continue;
    const fields = changedFields(had, want).filter((k) => !same(live[k], want[k]));
    if (fields.length === 0) continue;
    const next = { ...live, updatedAt: now } as Record<string, unknown>;
    for (const k of fields) {
      if (want[k] === undefined) delete next[k];
      else next[k] = want[k];
    }
    out.upserts.push(next as unknown as Element);
  }
  return out;
}

/** `elements` with a plan applied: deletes dropped, upserts replaced or appended. */
export function applyPlan(elements: readonly Element[], p: HistoryPlan): Element[] {
  const gone = new Set(p.deletes);
  const byId = new Map(p.upserts.map((e) => [e.id, e] as const));
  const next: Element[] = [];
  for (const e of elements) {
    if (gone.has(e.id)) continue;
    const replacement = byId.get(e.id);
    next.push(replacement ?? e);
    byId.delete(e.id);
  }
  next.push(...byId.values());
  return next;
}

// ── Writes that have not gone out yet ────────────────────────────────────────
//
// The inspector holds an edit for up to two seconds before sending it (one
// `update_element` per burst of slider ticks, not one per tick). An undo inside
// that window would write the old value, then the held edit would land on top
// and put the new one back. Whoever holds a write registers a flush here; undo
// and redo run every flush before they write.

const flushers = new Set<() => void>();

/** Register a function that sends any held write now. Returns its unregister. */
export function registerPendingWrite(flush: () => void): () => void {
  flushers.add(flush);
  return () => { flushers.delete(flush); };
}

export function flushPendingWrites(): void {
  for (const flush of [...flushers]) flush();
}
