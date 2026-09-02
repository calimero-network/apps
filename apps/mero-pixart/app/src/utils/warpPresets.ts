// ── Named warp shapes ────────────────────────────────────────────────────────
//
// The Transform panel's preset buttons and the bundled showcase projects both
// come through here, so a warp that ships in a demo document is literally the
// same maths a user gets from clicking a preset.
//
// These are CORNER-PIN warps: four handles, one per corner, interpolated
// bilinearly across the quad. That set of shapes is closed under "move the
// corners" — it can trapezoid, keystone, splay and twist a layer, but it cannot
// bow an edge, because a bowed edge needs a control point in the MIDDLE of the
// edge and there isn't one. So there is no "arch" or "bulge" here: those names
// would promise a curve the four pins cannot draw. (Photoshop's warp has a 4×4
// mesh; this is the 2×2 case.)

import type { WarpCorners } from "../types";

export const WARP_PRESETS = ["perspective", "keystone", "fan", "twist"] as const;
export type WarpPreset = (typeof WARP_PRESETS)[number];

export const WARP_PRESET_LABEL: Record<WarpPreset, string> = {
  perspective: "Perspective",
  keystone: "Keystone",
  fan: "Fan",
  twist: "Twist",
};

/**
 * Corner offsets for a named preset, scaled to the layer — the same preset looks
 * the same on a 200px badge and a 2000px banner.
 */
export function presetCorners(
  preset: WarpPreset, layer: { width: number; height: number },
): WarpCorners {
  const kx = Math.round(layer.width * 0.12);
  const ky = Math.round(layer.height * 0.12);
  switch (preset) {
    case "perspective":
      // Top edge narrowed: a plane tilting away from the viewer.
      return { tl: [kx, 0], tr: [-kx, 0], br: [0, 0], bl: [0, 0] };
    case "keystone":
      // Right edge stretched vertically: a projection thrown off-axis.
      return { tl: [0, 0], tr: [0, -ky], br: [0, ky], bl: [0, 0] };
    case "fan":
      // Bottom edge splayed wider and pushed down.
      return { tl: [0, 0], tr: [0, 0], br: [kx, Math.round(ky / 2)], bl: [-kx, Math.round(ky / 2)] };
    case "twist":
      // Adjacent corners displaced in opposite directions — a lazy S.
      return { tl: [0, -ky], tr: [0, ky], br: [0, -ky], bl: [0, ky] };
  }
}

/** Keep an angle in -180..180 so a slider always shows the value it stores. */
export function wrapAngle(deg: number): number {
  let a = ((deg + 180) % 360 + 360) % 360 - 180;
  if (a === -180) a = 180;
  return Math.round(a);
}
