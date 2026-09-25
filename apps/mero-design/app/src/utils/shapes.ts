import type { Element, ShapeKind, StrokeStyle } from "../types";

/**
 * Geometry and paint for the shape tools.
 *
 * Triangle, diamond, star and cloud are stored as `path` elements, and their
 * outline is REGENERATED from `shape` at the element's current size every time
 * it is drawn, rather than scaled from the stored `points`. Scaling a stored
 * path stretches it (a star squashed by a resize keeps its old points'
 * proportions and its stroke gets thicker on one axis); regenerating keeps the
 * stroke uniform and the shape crisp at any size.
 *
 * `points` is still written, at creation size, so a client that predates
 * `shape` draws the right outline instead of nothing.
 *
 * ⚠️ Every generator fills its box EXACTLY: min x/y = 0, max x/y = w/h. Fabric
 * sizes a Path by its path's own bounds, and the canvas persists
 * `width * scaleX` back to the contract — so an outline that stops short of its
 * box (a star's points do not reach the corners) would shrink the element by
 * the gap on every single save.
 */

export const SHAPE_KINDS: readonly ShapeKind[] = ["triangle", "diamond", "star", "cloud"];

type Pt = [number, number];

/** Stretch arbitrary points so their bounds are exactly [0,w]×[0,h]. */
function fit(points: Pt[], w: number, h: number): Pt[] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const sx = maxX - minX || 1;
  const sy = maxY - minY || 1;
  return points.map(([x, y]) => [((x - minX) / sx) * w, ((y - minY) / sy) * h]);
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function closedPath(points: Pt[]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${r1(x)} ${r1(y)}`).join(" ") + " Z";
}

function starPoints(): Pt[] {
  const pts: Pt[] = [];
  // Chunkier than the golden-ratio 0.382, so it still reads as a star at 4px.
  const inner = 0.47;
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 1 : inner;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

/**
 * A cloud: eight rounded lobes meeting at inward cusps. Sampled as a dense
 * polygon rather than built from arcs so `fit` can pin its bounds exactly —
 * Fabric computes a bezier's bounds from its true extremes, which would have to
 * be solved for, not read off the control points.
 */
function cloudPoints(): Pt[] {
  // Uneven lobes look drawn; even ones look like a flower.
  const amp = [0.2, 0.26, 0.18, 0.24, 0.28, 0.2, 0.25, 0.22];
  const lobes = amp.length;
  const pts: Pt[] = [];
  const samples = 160;
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const phase = (t * lobes) / 2;
    const lobe = Math.floor((t / (Math.PI * 2)) * lobes) % lobes;
    const r = 0.78 + amp[lobe] * Math.sqrt(Math.abs(Math.sin(phase)));
    // Wider than tall, like a cloud.
    pts.push([Math.cos(t) * r * 1.35, Math.sin(t) * r]);
  }
  return pts;
}

/** SVG path data for `kind`, filling [0,w]×[0,h]. */
export function shapePath(kind: ShapeKind, w: number, h: number): string {
  const W = Math.max(1, w);
  const H = Math.max(1, h);
  switch (kind) {
    case "triangle":
      return closedPath([[W / 2, 0], [W, H], [0, H]]);
    case "diamond":
      return closedPath([[W / 2, 0], [W, H / 2], [W / 2, H], [0, H / 2]]);
    case "star":
      return closedPath(fit(starPoints(), W, H));
    case "cloud":
      return closedPath(fit(cloudPoints(), W, H));
  }
}

export function isShapeKind(v: unknown): v is ShapeKind {
  return typeof v === "string" && (SHAPE_KINDS as readonly string[]).includes(v);
}

/* ── Stroke styles ─────────────────────────────────────────────────── */

export const STROKE_STYLES: { value: StrokeStyle; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
  { value: "dashdot", label: "Dash-dot" },
  { value: "dotted3", label: "Triple dot" },
  { value: "long", label: "Long dash" },
];

/**
 * The dash pattern for a style, in canvas units, scaled by the stroke width so a
 * 1px and a 12px border read as the same style. Undefined = solid.
 *
 * Dots are zero-length dashes drawn with a round cap (see `strokeCap`) — the
 * only way to get round dots from a dash array in both canvas and SVG.
 */
export function dashArray(style: StrokeStyle | undefined, strokeWidth: number): number[] | undefined {
  const w = Math.max(1, strokeWidth);
  switch (style) {
    case "dashed":  return [w * 3, w * 2];
    case "dotted":  return [0, w * 2];
    case "dashdot": return [w * 4, w * 2, 0, w * 2];
    case "dotted3": return [0, w * 1.8, 0, w * 1.8, 0, w * 4.5];
    case "long":    return [w * 7, w * 3];
    default:        return undefined;
  }
}

/** Dot-based patterns need a round cap or their zero-length dashes vanish. */
export function strokeCap(style: StrokeStyle | undefined): "round" | "butt" {
  return style === "dotted" || style === "dashdot" || style === "dotted3" ? "round" : "butt";
}

/* ── Defaults for new shapes ───────────────────────────────────────── */

/** A new shape is an outline: no fill, a 4px stroke — a plain container. */
export const DEFAULT_SHAPE_STROKE = "#1e1e1e";
export const DEFAULT_SHAPE_STROKE_WIDTH = 4;
/** What "Rounded rectangle" means, before the radius is clamped to the box. */
export const ROUNDED_CORNER_RADIUS = 16;

/* ── Sticky notes ──────────────────────────────────────────────────── */

export const STICKY_COLORS: { value: string; label: string }[] = [
  { value: "#FFE27A", label: "Yellow" },
  { value: "#FFC38A", label: "Orange" },
  { value: "#FFB3C7", label: "Pink" },
  { value: "#D9C6FF", label: "Purple" },
  { value: "#A9D4FF", label: "Blue" },
  { value: "#B8EFB0", label: "Green" },
  { value: "#E6E6EA", label: "Grey" },
];

export const STICKY_SIZE = 200;

/**
 * Quick colours for fills and strokes, in the spirit of Excalidraw's palette:
 * a handful of distinct hues is what most edits need, and the full picker
 * stays one click away.
 */
export const SWATCHES = [
  "#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00",
  "#9c36b5", "#0c8599", "#868e96", "#ffffff",
];

/** Relative luminance (WCAG) of a #rgb/#rrggbb colour; null if unparseable. */
export function luminance(colour: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The text colour to use on `fill` when none was chosen: near-black on light
 * fills and on no fill at all, white on dark ones.
 */
export function inkFor(fill: string | null | undefined): string {
  const l = fill ? luminance(fill) : null;
  return l !== null && l < 0.35 ? "#ffffff" : "#1e1e1e";
}

/** The element a creation tool produces, before it gets its geometry. */
export function shapeDefaults(tool: string): Pick<Element, "fill" | "stroke" | "strokeWidth" | "cornerRadius" | "shape"> & { kind: "rect" | "circle" | "path" } {
  const outline = { fill: "transparent", stroke: DEFAULT_SHAPE_STROKE, strokeWidth: DEFAULT_SHAPE_STROKE_WIDTH };
  if (tool === "circle") return { kind: "circle", ...outline };
  if (tool === "rounded") return { kind: "rect", ...outline, cornerRadius: ROUNDED_CORNER_RADIUS };
  if (isShapeKind(tool)) return { kind: "path", ...outline, shape: tool };
  return { kind: "rect", ...outline };
}
