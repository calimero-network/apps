// ── Showcase document format ─────────────────────────────────────────────────
//
// A showcase project is a *recipe*, not a picture: every layer's pixels are
// described as a short list of paint operations and rendered in the browser when
// the project is opened.
//
// Why not ship PNGs? A 1600×2000 poster is megabytes of base64 in the bundle,
// looks soft on a retina screen, and cannot be resized. A recipe is a few kB,
// renders crisp at any size, and — the part that matters for a showcase — is
// readable: you can see that the aurora ribbon is a blurred bezier and the
// reflection is the same mountain layer with `flipV`, which is exactly the point
// being demonstrated.
//
// Coordinates are in the layer's own pixel space (0,0 = its top-left), so a
// layer's recipe is independent of where it sits in the document.

import type { Adjustments, BlendMode, WarpCorners } from "../types";
import type { WarpPreset } from "../utils/warpPresets";

export type Stop = [offset: number, color: string];

/** A single drawing operation inside one layer. */
export type PaintOp =
  /** Flood the whole layer. */
  | { op: "fill"; color: string }
  /** Axis-free linear gradient across the layer. */
  | { op: "linear"; from: [number, number]; to: [number, number]; stops: Stop[] }
  /** Radial gradient — the workhorse for glows and vignettes. */
  | { op: "radial"; at: [number, number]; r0: number; r1: number; stops: Stop[] }
  /** Rectangle, optionally rounded and/or stroked. */
  | {
      op: "rect"; x: number; y: number; w: number; h: number; color: string;
      radius?: number; stroke?: boolean; width?: number; alpha?: number;
      shadow?: Shadow;
    }
  | {
      op: "ellipse"; cx: number; cy: number; rx: number; ry: number; color: string;
      stroke?: boolean; width?: number; alpha?: number; rotate?: number; shadow?: Shadow;
    }
  /** Closed or open polygon through flat [x0,y0,x1,y1,…] points. */
  | {
      op: "polygon"; points: number[]; color: string;
      stroke?: boolean; width?: number; alpha?: number; close?: boolean; shadow?: Shadow;
    }
  /** SVG path data — the escape hatch for anything the primitives cannot say. */
  | {
      op: "path"; d: string; color: string; stroke?: boolean; width?: number;
      alpha?: number; cap?: CanvasLineCap; join?: CanvasLineJoin; shadow?: Shadow;
      /** stroke with a gradient instead of a flat colour */
      gradient?: { from: [number, number]; to: [number, number]; stops: Stop[] };
    }
  | {
      op: "line"; from: [number, number]; to: [number, number]; color: string;
      width?: number; alpha?: number; cap?: CanvasLineCap; dash?: number[];
    }
  | {
      op: "text"; text: string; x: number; y: number; size: number; color: string;
      font?: string; weight?: number; italic?: boolean; align?: CanvasTextAlign;
      lineHeight?: number; tracking?: number; alpha?: number; shadow?: Shadow;
      /** paint the glyphs with a gradient instead of a flat colour */
      gradient?: { from: [number, number]; to: [number, number]; stops: Stop[] };
    }
  /** Evenly spaced rule lines — grids, ledger paper, technical overlays. */
  | { op: "grid"; step: number; color: string; width?: number; alpha?: number }
  /** Dot matrix (halftone-ish texture). */
  | { op: "dots"; step: number; r: number; color: string; alpha?: number }
  /** Diagonal hatch. */
  | { op: "stripes"; angle: number; width: number; gap: number; color: string; alpha?: number }
  /** Concentric rings, for target/ripple motifs. */
  | { op: "rings"; cx: number; cy: number; from: number; to: number; step: number; color: string; width?: number; alpha?: number }
  /** Per-pixel grain. Deterministic: same seed → same grain, every time. */
  | { op: "noise"; amount: number; mono?: boolean; seed?: number; alpha?: number }
  /** Blur everything drawn so far in this layer. */
  | { op: "blur"; radius: number }
  /** Keep only where previous ops drew (`in`) or punch them out (`out`). */
  | { op: "clip"; mode: "in" | "out"; ops: PaintOp[] };

export interface Shadow {
  blur: number;
  color: string;
  offset?: [number, number];
}

export interface ShowcaseText {
  content: string;
  fontFamily?: string;
  fontSize: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  align?: string;
}

export interface ShowcaseLayer {
  name: string;
  kind: "raster" | "text" | "fill" | "group";
  /** Name of the folder (a `kind: "group"` entry) this layer belongs to. */
  group?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  blend?: BlendMode;
  rotation?: number;
  skewX?: number;
  skewY?: number;
  flipH?: boolean;
  flipV?: boolean;
  /** A named preset or explicit corner offsets. */
  warp?: WarpPreset | WarpCorners;
  adjustments?: Partial<Adjustments>;
  visible?: boolean;
  locked?: boolean;
  /** Solid colour for `kind: "fill"`. */
  fill?: string;
  /** Typography for `kind: "text"`. */
  text?: ShowcaseText;
  /** Pixel recipe for `kind: "raster"` (and paint-on-fill layers). */
  paint?: PaintOp[];
  /** Grayscale mask recipe — white reveals, black hides. */
  mask?: PaintOp[];
}

export interface ShowcaseProject {
  id: string;
  name: string;
  /** One line for the picker card. */
  tagline: string;
  /** What a reader should look at in this document. */
  notes: string[];
  width: number;
  height: number;
  background: string;
  layers: ShowcaseLayer[];
}
