// ── "Bauhaus Grid" — a geometric poster ──────────────────────────────────────
//
// The showcase for the transform gizmo: a fan-warped title, a 22° sheared bar,
// a rotated sidebar of type and a tilted triangle, all as live params. Select any
// of them and the Transform panel shows exactly the numbers that made it.

import type { ShowcaseProject } from "../types";

const W = 1400;
const H = 1750;

const PAPER = "#F3EEE3";
const RED = "#D7263D";
const BLUE = "#1B4B8F";
const YELLOW = "#F2B31A";
const INK = "#141414";

export const bauhaus: ShowcaseProject = {
  id: "bauhaus",
  name: "Bauhaus Grid",
  tagline: "Geometric poster — warped title, sheared bars, rotated type.",
  notes: [
    "\"BAUHAUS\" carries a Fan warp; drag its corner pins in Warp mode to reshape it.",
    "The blue bar is a 22° horizontal shear — Skew X in the Transform panel.",
    "The sidebar text is a −90° rotation, the triangle a 14° one.",
    "Folders: Paper, Grid, Shapes, Type, Ink.",
  ],
  width: W,
  height: H,
  background: PAPER,
  layers: [
    { name: "Paper", kind: "group", x: 0, y: 0, width: W, height: H },
    { name: "Base", kind: "fill", group: "Paper", fill: PAPER, x: 0, y: 0, width: W, height: H, locked: true },

    // ── Grid ──────────────────────────────────────────────────────────────────
    { name: "Grid", kind: "group", x: 0, y: 0, width: W, height: H },
    {
      name: "Rule grid", kind: "raster", group: "Grid",
      x: 0, y: 0, width: W, height: H, opacity: 45,
      paint: [{ op: "grid", step: 70, color: "rgba(20,20,20,0.16)", width: 1 }],
    },
    {
      name: "Margin", kind: "raster", group: "Grid",
      x: 70, y: 70, width: W - 140, height: H - 140, opacity: 70,
      paint: [{ op: "rect", x: 0, y: 0, w: W - 140, h: H - 140, color: INK, stroke: true, width: 3 }],
    },

    // ── Shapes ────────────────────────────────────────────────────────────────
    { name: "Shapes", kind: "group", x: 70, y: 210, width: W - 140, height: 900 },
    {
      name: "Circle · red", kind: "raster", group: "Shapes",
      x: 140, y: 250, width: 620, height: 620,
      paint: [{ op: "ellipse", cx: 310, cy: 310, rx: 310, ry: 310, color: RED }],
    },
    {
      name: "Half circle · blue", kind: "raster", group: "Shapes", blend: "multiply",
      x: 560, y: 250, width: 460, height: 620,
      paint: [{ op: "path", d: "M 0 310 A 230 310 0 0 1 460 310 L 460 620 L 0 620 Z", color: BLUE }],
    },
    {
      // A 14° rotation, plainly visible against the grid.
      name: "Triangle · yellow", kind: "raster", group: "Shapes",
      x: 760, y: 620, width: 420, height: 420, rotation: 14,
      paint: [{ op: "polygon", points: [210, 0, 420, 420, 0, 420], color: YELLOW }],
    },
    {
      // 22° of horizontal shear — the Skew X control, made visible.
      name: "Bar · sheared", kind: "raster", group: "Shapes",
      x: 150, y: 1010, width: 900, height: 96, skewX: 22,
      paint: [{ op: "rect", x: 0, y: 0, w: 900, h: 96, color: BLUE }],
    },
    {
      name: "Rings", kind: "raster", group: "Shapes",
      x: 900, y: 300, width: 400, height: 400, opacity: 80,
      paint: [{ op: "rings", cx: 200, cy: 200, from: 26, to: 196, step: 26, color: INK, width: 3 }],
    },
    {
      name: "Quarter · red", kind: "raster", group: "Shapes",
      x: 140, y: 830, width: 260, height: 260, blend: "multiply",
      paint: [{ op: "path", d: "M 0 260 L 0 0 A 260 260 0 0 1 260 260 Z", color: RED }],
    },
    {
      name: "Dot field", kind: "raster", group: "Shapes",
      x: 1040, y: 830, width: 220, height: 220, opacity: 85,
      paint: [{ op: "dots", step: 30, r: 6, color: INK }],
    },

    // ── Type ──────────────────────────────────────────────────────────────────
    { name: "Type", kind: "group", x: 70, y: 1150, width: W - 140, height: 500 },
    {
      // The Fan preset: the exact corner offsets the panel's "Fan" button writes.
      name: "Title", kind: "raster", group: "Type",
      x: 100, y: 1180, width: 1200, height: 250, warp: "fan",
      paint: [
        { op: "text", text: "BAUHAUS", x: 600, y: 10, size: 210, weight: 800,
          align: "center", color: INK, tracking: 6 },
      ],
    },
    {
      name: "Subtitle", kind: "text", group: "Type",
      x: 108, y: 1452, width: 900, height: 90,
      text: { content: "Form follows function — 1919", fontSize: 44, color: BLUE, bold: false, fontFamily: "Georgia" },
    },
    {
      name: "Colophon", kind: "raster", group: "Type",
      x: 108, y: 1552, width: 900, height: 60,
      paint: [
        { op: "text", text: "PRINTED ON A CALIMERO NODE — MEROPIXART", x: 0, y: 0,
          size: 20, weight: 600, color: "rgba(20,20,20,0.6)", tracking: 5 },
      ],
    },
    {
      // Rotated a quarter turn — the same `rotation` field, at 90°.
      // −90° about the layer's own centre, so the box is authored horizontally
      // and placed by where its centre should land.
      name: "Sidebar", kind: "raster", group: "Type",
      x: 1010, y: 1102, width: 560, height: 56, rotation: -90,
      paint: [
        { op: "text", text: "STAATLICHES BAUHAUS WEIMAR", x: 0, y: 0, size: 24,
          weight: 700, color: RED, tracking: 6 },
      ],
    },

    // ── Ink ───────────────────────────────────────────────────────────────────
    { name: "Ink", kind: "group", x: 0, y: 0, width: W, height: H },
    {
      name: "Hatch", kind: "raster", group: "Ink", blend: "multiply",
      x: 0, y: 0, width: W, height: H, opacity: 10,
      paint: [{ op: "stripes", angle: 45, width: 2, gap: 12, color: INK }],
    },
    {
      name: "Press texture", kind: "raster", group: "Ink", blend: "multiply",
      x: 0, y: 0, width: W, height: H, opacity: 12,
      paint: [{ op: "noise", amount: 0.75, mono: true, seed: 33, alpha: 0.5 }],
    },
  ],
};
