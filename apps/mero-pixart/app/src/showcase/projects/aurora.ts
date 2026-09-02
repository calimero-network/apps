// ── "Aurora Edition" — a product launch ad ───────────────────────────────────
//
// The showcase for compositing: screen-blended aurora ribbons over a night
// gradient, a product card lifted off the page with a perspective warp and a
// rotation, a masked glare, and grain + vignette on top. Everything lives in
// named folders, so the layers panel reads like a designer's file rather than
// forty rows called "Layer".

import type { ShowcaseProject } from "../types";

const W = 1400;
const H = 1800;

const INK = "#05080F";
const LIME = "#A5FF11";
const MINT = "#23E6C8";
const VIOLET = "#7A5CFF";

export const aurora: ShowcaseProject = {
  id: "aurora",
  name: "Aurora Edition",
  tagline: "Product launch poster — ribbons, a warped card and real type.",
  notes: [
    "Six folders: Background, Aurora, Product, Copy, CTA and the finishing pass.",
    "The card uses a perspective warp plus an 8° rotation; its glare rides the same transform.",
    "The ribbons are blurred beziers on Screen blend — no bitmaps anywhere.",
    "Headline is a live text layer: double-click it on the canvas and retype.",
  ],
  width: W,
  height: H,
  background: INK,
  layers: [
    // ── Background ────────────────────────────────────────────────────────────
    { name: "Background", kind: "group", x: 0, y: 0, width: W, height: H },
    {
      name: "Night", kind: "fill", group: "Background", fill: INK,
      x: 0, y: 0, width: W, height: H, locked: true,
    },
    {
      name: "Horizon glow", kind: "raster", group: "Background", blend: "screen",
      x: 0, y: 0, width: W, height: H, opacity: 85,
      paint: [
        { op: "radial", at: [W * 0.5, H * 0.34], r0: 0, r1: W * 0.72,
          stops: [[0, "rgba(35,90,150,0.85)"], [0.45, "rgba(24,52,96,0.45)"], [1, "rgba(5,8,15,0)"]] },
        { op: "radial", at: [W * 0.18, H * 0.72], r0: 0, r1: W * 0.5,
          stops: [[0, "rgba(122,92,255,0.30)"], [1, "rgba(5,8,15,0)"]] },
      ],
    },
    {
      name: "Star field", kind: "raster", group: "Background",
      x: 0, y: 0, width: W, height: Math.round(H * 0.62), opacity: 70,
      paint: [
        { op: "dots", step: 74, r: 1.1, color: "#DCE7F5", alpha: 0.5 },
        { op: "dots", step: 173, r: 2.1, color: "#FFFFFF", alpha: 0.8 },
        { op: "ellipse", cx: W * 0.76, cy: 210, rx: 3.4, ry: 3.4, color: "#FFFFFF",
          shadow: { blur: 26, color: "#9FD0FF" } },
        { op: "ellipse", cx: W * 0.21, cy: 420, rx: 2.6, ry: 2.6, color: "#FFFFFF",
          shadow: { blur: 20, color: "#C7B4FF" } },
      ],
    },

    // ── Aurora ────────────────────────────────────────────────────────────────
    { name: "Aurora", kind: "group", x: 0, y: 120, width: W, height: 900 },
    {
      name: "Ribbon · violet", kind: "raster", group: "Aurora", blend: "screen",
      x: -120, y: 150, width: W + 240, height: 780, opacity: 70,
      paint: [
        { op: "path", d: "M 40 620 C 300 340 640 700 940 380 S 1420 260 1620 470",
          color: VIOLET, stroke: true, width: 150, alpha: 0.55,
          gradient: { from: [0, 0], to: [W, 0], stops: [[0, "rgba(122,92,255,0)"], [0.4, VIOLET], [1, "rgba(35,230,200,0.2)"]] } },
        { op: "blur", radius: 55 },
      ],
    },
    {
      name: "Ribbon · mint", kind: "raster", group: "Aurora", blend: "screen",
      x: -120, y: 90, width: W + 240, height: 760, opacity: 85,
      paint: [
        { op: "path", d: "M 0 500 C 260 250 560 560 880 300 S 1380 180 1640 360",
          color: MINT, stroke: true, width: 92, alpha: 0.7,
          gradient: { from: [0, 0], to: [W, 0], stops: [[0, "rgba(35,230,200,0)"], [0.5, MINT], [1, "rgba(165,255,17,0.35)"]] } },
        { op: "blur", radius: 26 },
      ],
    },
    {
      name: "Ribbon · core", kind: "raster", group: "Aurora", blend: "screen",
      x: -120, y: 90, width: W + 240, height: 760,
      paint: [
        { op: "path", d: "M 0 500 C 260 250 560 560 880 300 S 1380 180 1640 360",
          color: "#F2FFE0", stroke: true, width: 8, alpha: 0.9 },
        { op: "blur", radius: 6 },
      ],
    },

    // ── Product ───────────────────────────────────────────────────────────────
    { name: "Product", kind: "group", x: 300, y: 760, width: 1020, height: 700 },
    {
      name: "Card shadow", kind: "raster", group: "Product",
      x: 300, y: 830, width: 940, height: 560, opacity: 70,
      paint: [
        { op: "rect", x: 60, y: 40, w: 820, h: 440, radius: 44, color: "rgba(0,0,0,0.9)",
          shadow: { blur: 90, color: "rgba(0,0,0,0.9)", offset: [0, 40] } },
        { op: "blur", radius: 42 },
      ],
    },
    {
      // A perspective warp plus a rotation: the card leans into the page, and
      // because both are live transform params you can still drag either one.
      name: "Card", kind: "raster", group: "Product",
      x: 330, y: 800, width: 900, height: 520,
      rotation: -7, warp: "perspective",
      paint: [
        // Body: a full-bleed gradient clipped back to a rounded rectangle —
        // cheaper to read than a rounded-rect gradient fill, and the clip op is
        // the same one the water edge uses in Sunset Ridge.
        { op: "linear", from: [0, 0], to: [900, 520],
          stops: [[0, "#12233A"], [0.55, "#0B1524"], [1, "#152C1C"]] },
        { op: "clip", mode: "in", ops: [{ op: "rect", x: 0, y: 0, w: 900, h: 520, radius: 40, color: "#fff" }] },
        // bezel highlight
        { op: "rect", x: 0, y: 0, w: 900, h: 520, radius: 40, color: "rgba(255,255,255,0.22)", stroke: true, width: 3 },
        // screen
        { op: "rect", x: 46, y: 46, w: 808, h: 428, radius: 26, color: "#060C14" },
        // chart
        { op: "path", d: "M 96 380 L 240 300 L 372 336 L 512 210 L 660 250 L 800 128",
          color: LIME, stroke: true, width: 9 },
        { op: "path", d: "M 96 380 L 240 300 L 372 336 L 512 210 L 660 250 L 800 128 L 800 430 L 96 430 Z",
          color: "rgba(165,255,17,0.12)" },
        { op: "grid", step: 96, color: "rgba(255,255,255,0.05)", width: 1 },
        // bars
        { op: "rect", x: 96, y: 404, w: 120, h: 12, radius: 6, color: "rgba(255,255,255,0.25)" },
        { op: "rect", x: 96, y: 96, w: 210, h: 14, radius: 7, color: "rgba(255,255,255,0.35)" },
        { op: "rect", x: 96, y: 126, w: 128, h: 14, radius: 7, color: "rgba(35,230,200,0.75)" },
        // little mark
        { op: "ellipse", cx: 792, cy: 108, rx: 22, ry: 22, color: LIME },
        { op: "ellipse", cx: 792, cy: 108, rx: 34, ry: 34, color: "rgba(165,255,17,0.45)", stroke: true, width: 3 },
      ],
    },
    {
      // Same transform as the card, so the highlight stays glued to the glass.
      name: "Glare", kind: "raster", group: "Product", blend: "screen",
      x: 330, y: 800, width: 900, height: 520, opacity: 32,
      rotation: -7, warp: "perspective",
      paint: [
        { op: "polygon", points: [0, 520, 380, 0, 620, 0, 240, 520], color: "#FFFFFF", alpha: 0.65 },
        { op: "blur", radius: 24 },
      ],
      mask: [
        { op: "fill", color: "#000000" },
        { op: "rect", x: 0, y: 0, w: 900, h: 520, radius: 40, color: "#FFFFFF" },
      ],
    },

    // ── Copy ──────────────────────────────────────────────────────────────────
    { name: "Copy", kind: "group", x: 110, y: 200, width: 1180, height: 420 },
    {
      name: "Eyebrow", kind: "raster", group: "Copy",
      x: 120, y: 210, width: 620, height: 46,
      paint: [
        { op: "text", text: "NEW RELEASE — SPRING 2026", x: 0, y: 6, size: 22,
          weight: 600, color: MINT, tracking: 6 },
      ],
    },
    {
      // A live text layer, so the very first thing anyone tries — retyping the
      // headline — works without rasterising anything.
      name: "Headline", kind: "text", group: "Copy",
      x: 116, y: 262, width: 900, height: 300,
      text: { content: "Aurora\nEdition", fontSize: 132, color: "#FFFFFF", bold: true, fontFamily: "Inter" },
    },
    {
      name: "Rule", kind: "raster", group: "Copy",
      x: 120, y: 560, width: 320, height: 6,
      paint: [{ op: "linear", from: [0, 0], to: [320, 0], stops: [[0, LIME], [1, "rgba(165,255,17,0)"]] }],
    },
    {
      name: "Body", kind: "raster", group: "Copy",
      x: 120, y: 596, width: 640, height: 150,
      paint: [
        { op: "text",
          text: "Twelve hours of light, in a case that fits\na coat pocket. Built on Calimero, so\nyour library never leaves your nodes.",
          x: 0, y: 0, size: 28, weight: 400, lineHeight: 44, color: "#9FB6CE" },
      ],
    },

    // ── CTA ───────────────────────────────────────────────────────────────────
    { name: "CTA", kind: "group", x: 110, y: 1400, width: 620, height: 140 },
    {
      name: "Button", kind: "raster", group: "CTA",
      x: 120, y: 1410, width: 470, height: 108,
      paint: [
        { op: "rect", x: 0, y: 0, w: 470, h: 108, radius: 54, color: LIME,
          shadow: { blur: 46, color: "rgba(165,255,17,0.45)", offset: [0, 12] } },
        { op: "text", text: "Pre-order  →", x: 235, y: 32, size: 36, weight: 700,
          align: "center", color: "#08120A" },
      ],
    },
    {
      name: "Fine print", kind: "raster", group: "CTA",
      x: 122, y: 1544, width: 700, height: 40,
      paint: [
        { op: "text", text: "Ships 04.2026 · free returns for 60 days", x: 0, y: 0,
          size: 20, weight: 400, color: "#61748C" },
      ],
    },

    // ── Finishing ─────────────────────────────────────────────────────────────
    { name: "Finishing", kind: "group", x: 0, y: 0, width: W, height: H },
    {
      name: "Grain", kind: "raster", group: "Finishing", blend: "overlay",
      x: 0, y: 0, width: W, height: H, opacity: 20,
      paint: [{ op: "noise", amount: 0.9, mono: true, seed: 7, alpha: 0.5 }],
    },
    {
      name: "Vignette", kind: "raster", group: "Finishing", blend: "multiply",
      x: 0, y: 0, width: W, height: H, opacity: 62,
      paint: [
        { op: "radial", at: [W / 2, H * 0.45], r0: W * 0.28, r1: W * 0.92,
          stops: [[0, "rgba(255,255,255,1)"], [1, "rgba(20,26,40,1)"]] },
      ],
    },
  ],
};
