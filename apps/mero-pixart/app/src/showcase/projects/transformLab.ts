// ── "Transform Lab" — one tile, ten transforms ────────────────────────────────
//
// A reference sheet rather than a picture: the same specimen tile repeated with a
// different transform each time, labelled with the exact params. Select a tile
// and the Transform panel reads back what you see.
//
// It also demonstrates nested folders — Specimens ▸ Row 1 / Row 2 — and that
// dragging a folder moves everything inside it, labels included.

import type { PaintOp, ShowcaseLayer, ShowcaseProject } from "../types";

const W = 1680;
const H = 1000;

const TILE = 230;
const GAP_X = 90;
const GAP_Y = 190;
const ORIGIN_X = 110;
const ORIGIN_Y = 210;

const LIME = "#A5FF11";
const MINT = "#23E6C8";

/**
 * The specimen: an asymmetric tile. Asymmetry is the point — a plain square
 * cannot show you a mirror, and a symmetric one cannot show you a shear.
 */
function tilePaint(index: number): PaintOp[] {
  return [
    { op: "linear", from: [0, 0], to: [TILE, TILE], stops: [[0, "#1B2A3C"], [1, "#0C141F"]] },
    { op: "rect", x: 0, y: 0, w: TILE, h: TILE, color: "rgba(165,255,17,0.55)", stroke: true, width: 3 },
    // an "F" reads orientation instantly, the way type specimens do
    { op: "text", text: "F", x: 26, y: 24, size: 132, weight: 800, color: LIME },
    // corner pip marks the original top-left
    { op: "ellipse", cx: 24, cy: 22, rx: 9, ry: 9, color: MINT },
    // arrow along the top edge
    { op: "path", d: `M ${TILE - 96} 40 L ${TILE - 30} 40 M ${TILE - 52} 24 L ${TILE - 30} 40 L ${TILE - 52} 56`,
      color: MINT, stroke: true, width: 5 },
    { op: "text", text: String(index).padStart(2, "0"), x: TILE - 26, y: TILE - 46,
      size: 30, weight: 700, align: "right", color: "rgba(255,255,255,0.5)" },
    { op: "grid", step: 46, color: "rgba(255,255,255,0.06)", width: 1 },
  ];
}

interface Specimen {
  label: string;
  transform: Partial<ShowcaseLayer>;
}

/** Every transform the editor can express, one per tile. */
const SPECIMENS: Specimen[] = [
  { label: "identity", transform: {} },
  { label: "rotation 24°", transform: { rotation: 24 } },
  { label: "skew X 28°", transform: { skewX: 28 } },
  { label: "skew Y −22°", transform: { skewY: -22 } },
  { label: "flip H", transform: { flipH: true } },
  { label: "flip V + rot 12°", transform: { flipV: true, rotation: 12 } },
  { label: "warp keystone", transform: { warp: "keystone" } },
  { label: "warp perspective", transform: { warp: "perspective" } },
  { label: "warp fan", transform: { warp: "fan" } },
  { label: "warp twist + skew", transform: { warp: "twist", skewX: 10 } },
];

const COLS = 5;

function specimenLayers(): ShowcaseLayer[] {
  const out: ShowcaseLayer[] = [
    { name: "Specimens", kind: "group", x: 60, y: 150, width: W - 120, height: H - 220 },
    { name: "Row 1", kind: "group", group: "Specimens", x: 60, y: 150, width: W - 120, height: 400 },
    { name: "Row 2", kind: "group", group: "Specimens", x: 60, y: 560, width: W - 120, height: 400 },
  ];

  SPECIMENS.forEach((spec, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = ORIGIN_X + col * (TILE + GAP_X);
    const y = ORIGIN_Y + row * (TILE + GAP_Y);
    const parent = row === 0 ? "Row 1" : "Row 2";
    out.push({
      name: `Tile ${String(i + 1).padStart(2, "0")}`,
      kind: "raster",
      group: parent,
      x, y, width: TILE, height: TILE,
      paint: tilePaint(i + 1),
      ...spec.transform,
    });
    out.push({
      name: `Label ${String(i + 1).padStart(2, "0")}`,
      kind: "raster",
      group: parent,
      x: x - 20, y: y + TILE + 26, width: TILE + 40, height: 40,
      paint: [
        { op: "text", text: spec.label, x: (TILE + 40) / 2, y: 0, size: 22,
          weight: 600, align: "center", color: "#9FB6CE" },
      ],
    });
  });

  return out;
}

export const transformLab: ShowcaseProject = {
  id: "transform-lab",
  name: "Transform Lab",
  tagline: "One tile, ten transforms — rotation, shear, mirror and warp side by side.",
  notes: [
    "Every tile is the same artwork; only its transform params differ.",
    "Nested folders: Specimens ▸ Row 1 / Row 2. Drag a row and its labels come along.",
    "Select a tile and the Transform panel reads back the exact numbers.",
    "Collapse Specimens to see the whole sheet as one line in the panel.",
  ],
  width: W,
  height: H,
  background: "#080C12",
  layers: [
    { name: "Sheet", kind: "group", x: 0, y: 0, width: W, height: H },
    { name: "Ground", kind: "fill", group: "Sheet", fill: "#080C12", x: 0, y: 0, width: W, height: H, locked: true },
    {
      name: "Blueprint", kind: "raster", group: "Sheet",
      x: 0, y: 0, width: W, height: H, opacity: 70,
      paint: [
        { op: "grid", step: 40, color: "rgba(165,255,17,0.05)", width: 1 },
        { op: "grid", step: 200, color: "rgba(165,255,17,0.11)", width: 1 },
      ],
    },
    {
      name: "Title", kind: "raster", group: "Sheet",
      x: 110, y: 70, width: 900, height: 90,
      paint: [
        { op: "text", text: "TRANSFORM LAB", x: 0, y: 0, size: 46, weight: 800,
          color: "#FFFFFF", tracking: 8 },
        { op: "text", text: "rotation · shear · mirror · corner-pin warp", x: 2, y: 58,
          size: 21, weight: 500, color: MINT, tracking: 2 },
      ],
    },
    ...specimenLayers(),
    {
      name: "Footnote", kind: "raster",
      x: 110, y: H - 74, width: 1100, height: 40,
      paint: [
        { op: "text",
          text: "Warp is drawn as a subdivided triangle mesh — Canvas 2D has no projective transform.",
          x: 0, y: 0, size: 19, weight: 400, color: "rgba(159,182,206,0.7)" },
      ],
    },
  ],
};
