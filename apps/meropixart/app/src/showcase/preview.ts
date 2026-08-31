// ── Showcase previews ────────────────────────────────────────────────────────
//
// Renders a showcase through the *real* compositor, so the picker's thumbnail is
// the document you get — blend modes, masks, warps and all — rather than a
// hand-drawn approximation that drifts the first time someone edits a project.

import { composite } from "../utils/compositor";
import { createCanvas, ctx2d } from "../utils/raster";
import { buildShowcase, stableIds } from "./build";
import type { ShowcaseProject } from "./types";

/** Full-resolution render of a project. */
export function renderShowcase(project: ShowcaseProject): HTMLCanvasElement {
  const { layers, canvases, masks } = buildShowcase(project, { idFor: stableIds(project) });
  return composite(layers, project.width, project.height, {
    background: project.background,
    sources: (id) => canvases.get(id) ?? null,
    masks: (id) => masks.get(id) ?? null,
  });
}

/**
 * Thumbnail, fitted inside `maxW × maxH` with the project's aspect ratio kept.
 *
 * The full render happens first and is then downscaled: rendering the recipe at
 * thumbnail size instead would drop hairlines and shift the type, and this runs
 * once per card.
 */
export function renderShowcaseThumb(
  project: ShowcaseProject, maxW: number, maxH: number,
): HTMLCanvasElement {
  const full = renderShowcase(project);
  const scale = Math.min(maxW / project.width, maxH / project.height, 1);
  const w = Math.max(1, Math.round(project.width * scale));
  const h = Math.max(1, Math.round(project.height * scale));
  const out = createCanvas(w, h);
  const ctx = ctx2d(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(full, 0, 0, w, h);
  return out;
}
