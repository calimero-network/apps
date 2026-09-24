/**
 * The geometry of dragging a screen row to a new place in the list.
 *
 * Pure, so the rules — which half of a row means "before", what happens past
 * either end, how a drop turns into a move — are unit-tested without a browser.
 * The Screens panel feeds it the rows' live rects on every pointer move.
 */

export type DropEdge = "before" | "after";
export interface DropSlot {
  index: number;
  edge: DropEdge;
}

/** How far, in px, a press must travel before it is a drag rather than a click. */
export const DRAG_THRESHOLD_PX = 4;

/**
 * Where a pointer at `clientY` would drop, given each row's vertical extent.
 * Above the first row is "before 0", below the last is "after last", so the
 * pointer never has to land exactly on a row to reach either end.
 */
export function dropSlotAt(
  rows: readonly { top: number; height: number }[],
  clientY: number,
): DropSlot | null {
  if (rows.length === 0) return null;
  for (let i = 0; i < rows.length; i++) {
    const { top, height } = rows[i];
    if (clientY < top + height) {
      return { index: i, edge: clientY < top + height / 2 ? "before" : "after" };
    }
  }
  return { index: rows.length - 1, edge: "after" };
}

/**
 * The index the dragged row ends up at, or null when the drop would leave it
 * where it is. Removing the dragged row first shifts every later slot up by one.
 */
export function moveTarget(from: number, drop: DropSlot): number | null {
  const insertAt = drop.edge === "before" ? drop.index : drop.index + 1;
  const to = insertAt > from ? insertAt - 1 : insertAt;
  return to === from ? null : to;
}
