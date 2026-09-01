// ── Showcase → layers ────────────────────────────────────────────────────────
//
// Turns a showcase recipe into real `Layer` objects plus the canvases their
// pixels live in. Deliberately free of contract and store calls: the picker uses
// it to render a live thumbnail through the real compositor, the loader uses it
// to produce exactly the layers it then persists, and the unit tests use it to
// check every project renders without touching the network.

import { v4 as uuid } from "uuid";
import { NEUTRAL_ADJUSTMENTS, type Layer, type WarpCorners } from "../types";
import { serializeWarp } from "../utils/transform";
import { presetCorners, WARP_PRESETS, type WarpPreset } from "../utils/warpPresets";
import { paintCanvas } from "./paint";
import type { ShowcaseLayer, ShowcaseProject } from "./types";

export interface BuiltShowcase {
  layers: Layer[];
  /** layer id → pixel canvas (raster layers with a recipe) */
  canvases: Map<string, HTMLCanvasElement>;
  /** layer id → grayscale mask canvas */
  masks: Map<string, HTMLCanvasElement>;
  /** Warnings for recipes that reference a folder that does not exist. */
  warnings: string[];
}

function isWarpPreset(v: unknown): v is WarpPreset {
  return typeof v === "string" && (WARP_PRESETS as readonly string[]).includes(v);
}

/** Resolve a recipe's `warp` (preset name or explicit corners) to storage form. */
export function resolveWarp(
  warp: ShowcaseLayer["warp"], size: { width: number; height: number },
): string {
  if (!warp) return "";
  if (isWarpPreset(warp)) return serializeWarp(presetCorners(warp, size));
  return serializeWarp(warp as WarpCorners);
}

/**
 * Build the layer list for a project.
 *
 * `idFor` exists so callers can choose their ids: the loader wants fresh uuids
 * (they become contract keys), the preview and the tests want deterministic ones
 * so a thumbnail is reproducible and an assertion can name a layer.
 */
export function buildShowcase(
  project: ShowcaseProject,
  opts: { idFor?: (layer: ShowcaseLayer, index: number) => string; author?: string; now?: number } = {},
): BuiltShowcase {
  const now = opts.now ?? 0;
  const author = opts.author ?? "";
  const idFor = opts.idFor ?? (() => uuid());

  const layers: Layer[] = [];
  const canvases = new Map<string, HTMLCanvasElement>();
  const masks = new Map<string, HTMLCanvasElement>();
  const warnings: string[] = [];
  /** folder name → layer id, filled as folders are created */
  const groupIds = new Map<string, string>();

  project.layers.forEach((spec, index) => {
    const id = idFor(spec, index);
    let parentId: string | null = null;
    if (spec.group) {
      const found = groupIds.get(spec.group);
      if (found) parentId = found;
      else warnings.push(`${project.id}: "${spec.name}" references unknown folder "${spec.group}"`);
    }
    if (spec.kind === "group") groupIds.set(spec.name, id);

    const layer: Layer = {
      id,
      name: spec.name,
      kind: spec.kind,
      parentId,
      // Array order is paint order, bottom-up — the first entry sits at the back.
      layerIndex: index,
      visible: spec.visible ?? true,
      locked: spec.locked ?? false,
      opacity: spec.opacity ?? 100,
      blendMode: spec.blend ?? "normal",
      x: Math.round(spec.x),
      y: Math.round(spec.y),
      width: Math.max(1, Math.round(spec.width)),
      height: Math.max(1, Math.round(spec.height)),
      rotation: spec.rotation ?? 0,
      scaleX: 100,
      scaleY: 100,
      skewX: spec.skewX ?? 0,
      skewY: spec.skewY ?? 0,
      flipH: spec.flipH ?? false,
      flipV: spec.flipV ?? false,
      warp: resolveWarp(spec.warp, { width: spec.width, height: spec.height }),
      blobId: "",
      // A mask blob id is what makes the compositor look for a mask at all; the
      // real id arrives when the loader uploads it, and the preview only needs a
      // non-empty placeholder.
      maskBlobId: spec.mask ? "pending" : null,
      fill: spec.fill ?? "",
      adjustments: { ...NEUTRAL_ADJUSTMENTS, ...spec.adjustments },
      text: spec.text
        ? {
            content: spec.text.content,
            fontFamily: spec.text.fontFamily ?? "Inter",
            fontSize: spec.text.fontSize,
            color: spec.text.color,
            bold: spec.text.bold ?? false,
            italic: spec.text.italic ?? false,
            align: spec.text.align ?? "left",
          }
        : null,
      createdBy: author,
      createdAt: now,
      updatedAt: now,
    };
    layers.push(layer);

    if (spec.paint && spec.paint.length > 0) {
      canvases.set(id, paintCanvas(spec.paint, layer.width, layer.height));
    }
    if (spec.mask && spec.mask.length > 0) {
      masks.set(id, paintCanvas(spec.mask, layer.width, layer.height));
    }
  });

  return { layers, canvases, masks, warnings };
}

/** Deterministic ids, for previews and tests: `<project>-<nn>`. */
export function stableIds(project: ShowcaseProject) {
  return (_spec: ShowcaseLayer, index: number) =>
    `${project.id}-${String(index).padStart(2, "0")}`;
}
