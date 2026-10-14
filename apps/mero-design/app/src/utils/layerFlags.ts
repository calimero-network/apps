import type { Element } from "../types";

/**
 * Lock and hide. Both are client-side extras carried in the label (see
 * `elementMeta.ts`), so they sync like a rename and need no contract field.
 *
 * Lock is a convenience, not a permission: it stops the CANVAS grabbing a
 * layer. The layers panel can still select, unlock and delete it, and any
 * editor can clear the flag.
 */
export type LayerFlag = "locked" | "hidden";

/** Whether the canvas may select, move or resize `el`. */
export function isInteractive(el: Pick<Element, "locked" | "hidden"> | undefined, readOnly: boolean): boolean {
  return !readOnly && !!el && !el.locked && !el.hidden;
}

/** What gets painted and exported: everything not hidden. */
export function visibleOnly<T extends Pick<Element, "hidden">>(elements: readonly T[]): T[] {
  return elements.filter((el) => !el.hidden);
}

/**
 * Toggle `flag` on the elements named by `ids`, as one action: if every one of
 * them already has it, clear it on all; otherwise set it on all. Returns the
 * value applied and the elements that change (unknown ids are skipped).
 */
export function toggleFlag(
  elements: readonly Element[],
  ids: readonly string[],
  flag: LayerFlag,
  now: number,
): { value: boolean; changed: Element[] } {
  const wanted = new Set(ids);
  const targets = elements.filter((el) => wanted.has(el.id));
  const value = !(targets.length > 0 && targets.every((el) => el[flag]));
  const changed = targets
    .filter((el) => !!el[flag] !== value)
    .map((el) => {
      const next: Element = { ...el, updatedAt: now };
      if (value) next[flag] = true;
      else delete next[flag];
      return next;
    });
  return { value, changed };
}
