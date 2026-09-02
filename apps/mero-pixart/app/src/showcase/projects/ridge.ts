// ── "Sunset Ridge" — an illustrated landscape ─────────────────────────────────
//
// The showcase for mirroring, masks and non-destructive adjustments: the lake is
// literally the mountain layers again with `flipV`, a gradient mask fading them
// into the water and a blur adjustment softening them. Nothing is baked, so you
// can drag a ridge and watch its reflection follow.

import type { ShowcaseProject } from "../types";

const W = 1800;
const H = 1200;

/** Horizon: where the ridges stop and the lake starts. */
const HZ = 660;

const FAR = "#7E5A86";
const MID = "#4E3161";
const NEAR = "#241A3A";

/** Silhouettes, authored once and reused for their own reflections. */
const RIDGE_FAR = [0, 300, 190, 150, 330, 232, 520, 60, 700, 205, 900, 96, 1080, 220, 1290, 120, 1500, 250, 1800, 140, 1800, 360, 0, 360];
const RIDGE_MID = [0, 330, 250, 200, 470, 285, 700, 130, 940, 265, 1180, 175, 1420, 300, 1650, 210, 1800, 275, 1800, 360, 0, 360];
const RIDGE_NEAR = [0, 355, 300, 275, 560, 340, 820, 215, 1080, 320, 1340, 255, 1600, 345, 1800, 300, 1800, 360, 0, 360];

export const ridge: ShowcaseProject = {
  id: "ridge",
  name: "Sunset Ridge",
  tagline: "Landscape study — flipped reflections, masks and blur adjustments.",
  notes: [
    "The three reflection layers are the ridges with Flip V — same shapes, mirrored.",
    "Each reflection carries a gradient layer mask, so it dissolves into the lake.",
    "Blur lives in the Adjustments panel: non-destructive, still editable.",
    "Folders: Sky, Ridges, Water, Foreground, Finishing.",
  ],
  width: W,
  height: H,
  background: "#160E2B",
  layers: [
    // ── Sky ───────────────────────────────────────────────────────────────────
    { name: "Sky", kind: "group", x: 0, y: 0, width: W, height: HZ },
    {
      name: "Dusk gradient", kind: "raster", group: "Sky", locked: true,
      x: 0, y: 0, width: W, height: HZ + 40,
      paint: [
        { op: "linear", from: [0, 0], to: [0, HZ + 40],
          stops: [[0, "#1A1038"], [0.34, "#5B2560"], [0.62, "#B4405A"], [0.82, "#EE7B45"], [1, "#FFC578"]] },
      ],
    },
    {
      // The retro banded sun: one layer, with the bands punched out of the disc
      // by a clip rather than laid over the sky as separate bars — a stencil that
      // travels with the artwork instead of a stack that has to stay aligned.
      name: "Sun", kind: "raster", group: "Sky", blend: "screen",
      x: W / 2 - 340, y: HZ - 470, width: 680, height: 680,
      paint: [
        { op: "ellipse", cx: 340, cy: 340, rx: 112, ry: 112, color: "#FFF3D4" },
        { op: "clip", mode: "out", ops: [
          { op: "rect", x: 200, y: 372, w: 280, h: 7, color: "#000" },
          { op: "rect", x: 200, y: 396, w: 280, h: 11, color: "#000" },
          { op: "rect", x: 200, y: 424, w: 280, h: 15, color: "#000" },
        ] },
        // halo, added after the disc so the punched gaps still glow
        { op: "radial", at: [340, 340], r0: 96, r1: 336,
          stops: [[0, "rgba(255,214,150,0.7)"], [0.4, "rgba(255,170,90,0.32)"], [1, "rgba(255,120,60,0)"]] },
      ],
    },
    {
      name: "Cloud bank", kind: "raster", group: "Sky",
      x: 0, y: 120, width: W, height: 380, opacity: 60,
      paint: [
        { op: "ellipse", cx: 380, cy: 190, rx: 300, ry: 44, color: "rgba(255,196,150,0.55)" },
        { op: "ellipse", cx: 1240, cy: 140, rx: 380, ry: 34, color: "rgba(255,170,140,0.45)" },
        { op: "ellipse", cx: 900, cy: 268, rx: 460, ry: 30, color: "rgba(255,220,180,0.35)" },
        { op: "blur", radius: 22 },
      ],
    },
    {
      name: "Birds", kind: "raster", group: "Sky",
      x: 1180, y: 210, width: 320, height: 160,
      paint: [
        { op: "path", d: "M 10 60 q 22 -20 44 0 q 22 -20 44 0", color: "#2C1836", stroke: true, width: 4 },
        { op: "path", d: "M 120 24 q 16 -14 32 0 q 16 -14 32 0", color: "#2C1836", stroke: true, width: 3 },
        { op: "path", d: "M 196 96 q 13 -11 26 0 q 13 -11 26 0", color: "#2C1836", stroke: true, width: 3 },
      ],
    },

    // ── Ridges ────────────────────────────────────────────────────────────────
    { name: "Ridges", kind: "group", x: 0, y: 260, width: W, height: 420 },
    {
      name: "Ridge · far", kind: "raster", group: "Ridges",
      x: 0, y: 300, width: W, height: HZ - 300, opacity: 85,
      paint: [{ op: "polygon", points: RIDGE_FAR, color: FAR }],
    },
    {
      name: "Ridge · mid", kind: "raster", group: "Ridges",
      x: 0, y: 300, width: W, height: HZ - 300,
      paint: [
        { op: "polygon", points: RIDGE_MID, color: MID },
        // sunlit western faces
        { op: "polygon", points: [700, 130, 940, 265, 820, 265], color: "rgba(255,170,120,0.28)" },
        { op: "polygon", points: [1180, 175, 1420, 300, 1300, 300], color: "rgba(255,170,120,0.20)" },
      ],
    },
    {
      name: "Ridge · near", kind: "raster", group: "Ridges",
      x: 0, y: 300, width: W, height: HZ - 300,
      paint: [
        { op: "polygon", points: RIDGE_NEAR, color: NEAR },
        { op: "polygon", points: [820, 215, 1080, 320, 950, 320], color: "rgba(255,150,110,0.14)" },
      ],
    },
    {
      name: "Valley mist", kind: "raster", group: "Ridges", blend: "screen",
      x: 0, y: HZ - 150, width: W, height: 150, opacity: 55,
      paint: [
        { op: "linear", from: [0, 150], to: [0, 0],
          stops: [[0, "rgba(255,214,190,0.75)"], [1, "rgba(255,214,190,0)"]] },
        { op: "blur", radius: 18 },
      ],
    },

    // ── Water ─────────────────────────────────────────────────────────────────
    { name: "Water", kind: "group", x: 0, y: HZ, width: W, height: H - HZ },
    {
      name: "Lake", kind: "raster", group: "Water", locked: true,
      x: 0, y: HZ, width: W, height: H - HZ,
      paint: [
        { op: "linear", from: [0, 0], to: [0, H - HZ],
          stops: [[0, "#C86A48"], [0.22, "#7A3357"], [0.62, "#33193F"], [1, "#180E2A"]] },
      ],
    },
    // The reflections: the same silhouettes, mirrored with Flip V, masked to
    // dissolve downward and softened with a live blur adjustment.
    //
    // Flip V mirrors a layer about its own centre, and every silhouette closes
    // on the same baseline (local y = 360, the layer's full height) — so the
    // mountain feet land on local y = 0, i.e. exactly on the horizon, and the
    // peaks point down into the water.
    {
      name: "Reflection · near", kind: "raster", group: "Water",
      x: 0, y: HZ, width: W, height: 360, opacity: 46, flipV: true,
      adjustments: { blur: 5, saturation: -15 },
      paint: [{ op: "polygon", points: RIDGE_NEAR, color: NEAR }],
      // Mask coordinates are in the layer's own space, so this is white at the
      // mountain base — which is the end that survives the flip, at the horizon.
      mask: [
        { op: "linear", from: [0, 360], to: [0, 120],
          stops: [[0, "#FFFFFF"], [0.5, "#8A8A8A"], [1, "#0A0A0A"]] },
      ],
    },
    {
      name: "Reflection · mid", kind: "raster", group: "Water",
      x: 0, y: HZ, width: W, height: 360, opacity: 32, flipV: true,
      adjustments: { blur: 8, saturation: -20 },
      paint: [{ op: "polygon", points: RIDGE_MID, color: MID }],
      mask: [
        { op: "linear", from: [0, 360], to: [0, 60],
          stops: [[0, "#FFFFFF"], [0.5, "#7A7A7A"], [1, "#0A0A0A"]] },
      ],
    },
    {
      name: "Sun streak", kind: "raster", group: "Water", blend: "screen",
      x: W / 2 - 310, y: HZ, width: 620, height: H - HZ, opacity: 75,
      paint: [
        // A fan rather than a column: a radial centred on the horizon spreads
        // downward and feathers its own edges, so there is no hard vertical seam.
        { op: "radial", at: [310, 6], r0: 18, r1: 300,
          stops: [[0, "rgba(255,232,186,0.95)"], [0.35, "rgba(255,178,116,0.45)"], [1, "rgba(255,140,90,0)"]] },
        // broken into ripples so it reads as water, not a spotlight
        { op: "clip", mode: "out", ops: Array.from({ length: 18 }, (_, i) => ({
          op: "rect" as const,
          x: -20, y: 22 + i * 30, w: 660, h: 6 + (i % 3) * 4,
          color: "#000000",
        })) },
        { op: "blur", radius: 7 },
      ],
    },
    {
      name: "Ripples", kind: "raster", group: "Water", blend: "screen",
      x: 0, y: HZ + 20, width: W, height: H - HZ - 20, opacity: 32,
      paint: [
        ...Array.from({ length: 22 }, (_, i) => ({
          op: "line" as const,
          from: [90 + (i % 5) * 140, 30 + i * 22] as [number, number],
          to: [520 + (i % 7) * 160, 30 + i * 22] as [number, number],
          color: "rgba(255,214,190,0.6)",
          width: 2,
          dash: [40 + (i % 4) * 26, 60],
        })),
      ],
    },

    // ── Foreground ────────────────────────────────────────────────────────────
    { name: "Foreground", kind: "group", x: 0, y: 900, width: W, height: 300 },
    {
      name: "Reeds", kind: "raster", group: "Foreground",
      x: 60, y: 940, width: 520, height: 260,
      paint: [
        { op: "path", d: "M 40 260 C 60 170 44 110 26 40", color: "#0E0A1C", stroke: true, width: 7 },
        { op: "path", d: "M 96 260 C 112 180 104 120 92 66", color: "#0E0A1C", stroke: true, width: 6 },
        { op: "path", d: "M 152 260 C 176 190 190 132 214 84", color: "#0E0A1C", stroke: true, width: 6 },
        { op: "ellipse", cx: 26, cy: 34, rx: 9, ry: 22, color: "#0E0A1C" },
        { op: "ellipse", cx: 92, cy: 60, rx: 8, ry: 19, color: "#0E0A1C" },
        { op: "ellipse", cx: 216, cy: 78, rx: 8, ry: 18, color: "#0E0A1C" },
      ],
    },
    {
      name: "Caption", kind: "text", group: "Foreground",
      x: 1180, y: 1032, width: 540, height: 120,
      text: { content: "Sunset Ridge", fontSize: 68, color: "#FFD9B0", bold: true, fontFamily: "Georgia" },
    },
    {
      name: "Coordinates", kind: "raster", group: "Foreground",
      x: 1186, y: 1122, width: 520, height: 40,
      paint: [
        { op: "text", text: "46.4102° N   13.8371° E   ·   18:44", x: 0, y: 0,
          size: 21, weight: 500, color: "rgba(255,217,176,0.65)", tracking: 3 },
      ],
    },

    // ── Finishing ─────────────────────────────────────────────────────────────
    { name: "Finishing", kind: "group", x: 0, y: 0, width: W, height: H },
    {
      name: "Grain", kind: "raster", group: "Finishing", blend: "overlay",
      x: 0, y: 0, width: W, height: H, opacity: 16,
      paint: [{ op: "noise", amount: 0.85, mono: true, seed: 21, alpha: 0.5 }],
    },
    {
      name: "Vignette", kind: "raster", group: "Finishing", blend: "multiply",
      x: 0, y: 0, width: W, height: H, opacity: 55,
      paint: [
        { op: "radial", at: [W / 2, H / 2], r0: W * 0.3, r1: W * 0.78,
          stops: [[0, "rgba(255,255,255,1)"], [1, "rgba(50,30,60,1)"]] },
      ],
    },
  ],
};
