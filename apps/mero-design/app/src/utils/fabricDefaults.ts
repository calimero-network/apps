import { FabricObject } from "fabric";

/**
 * Fabric 7 defaults `originX`/`originY` to `"center"`, so it reads `left`/`top` as
 * an object's *centre*. Every coordinate in this app is a top-left: the drawing
 * code takes `Math.min` of the drag corners, the properties panel edits x/y as a
 * corner, the contract stores them as a corner, and the HTML export writes them
 * as CSS `left`/`top`. Under v7 defaults every shape therefore paints offset by
 * half its own size — a 40x40 rect at (100,100) lands at (80,80).
 *
 * Restoring the v5/v6 semantics once, on the shared default, is deliberate: the
 * alternative is `originX`/`originY` on every construction site, and there are
 * eleven of them (each shape branch, the drag previews, the inline IText, the
 * image and its loading placeholder). One missed site is an invisible half-shape
 * offset, which is exactly the bug this fixes.
 *
 * Call once before any Fabric object is constructed. Verified by
 * `src/utils/fabricDefaults.test.ts` and by the geometry e2e specs.
 */
export function applyTopLeftOrigin(): void {
  FabricObject.ownDefaults.originX = "left";
  FabricObject.ownDefaults.originY = "top";
}
