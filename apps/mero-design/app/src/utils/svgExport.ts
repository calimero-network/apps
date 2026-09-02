import type { Element } from "../types";
import { escapeHtml } from "./sanitize";

/**
 * Elements → standalone SVG markup.
 *
 * Used for three things: exporting one group ("export this frame"), flattening a
 * group into a single `svg` element, and exporting a selection. It builds from
 * contract elements rather than asking Fabric for `toSVG()`, for one reason that
 * matters: Fabric emits `<image href="blob:…">` for bitmaps, and a blob URL is
 * dead the moment the document is opened anywhere else. Here the caller supplies
 * `data:` URLs (`imageData`) and they are embedded.
 *
 * Coordinates are top-left everywhere in this app (see `fabricDefaults`), so a
 * rotation is about the element's own top-left corner, matching what the canvas
 * paints.
 */

export interface SvgOptions {
  /** element id → `data:` URL. Anything missing is skipped, never linked. */
  imageData?: Record<string, string>;
  /** Painted behind everything, e.g. the board background. */
  background?: string;
  /** Extra space around the content box. */
  padding?: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isPainted(colour: string | null | undefined): boolean {
  return !!colour && colour !== "transparent" && colour !== "none";
}

/** The four corners of an element, rotated about its top-left. */
function corners(el: Element): { x: number; y: number }[] {
  const rad = ((el.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [0, 0],
    [el.width, 0],
    [el.width, el.height],
    [0, el.height],
  ].map(([dx, dy]) => ({
    x: el.x + dx * cos - dy * sin,
    y: el.y + dx * sin + dy * cos,
  }));
}

/** Content box of these elements, including stroke width and rotation. */
export function boundsOf(elements: Element[], padding = 0): Bounds {
  if (elements.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    // Half the stroke sits outside the shape; a fat border would otherwise be
    // clipped exactly in half at the edge of the export.
    const pad = isPainted(el.stroke) ? (el.strokeWidth ?? 0) / 2 : 0;
    for (const c of corners(el)) {
      minX = Math.min(minX, c.x - pad);
      minY = Math.min(minY, c.y - pad);
      maxX = Math.max(maxX, c.x + pad);
      maxY = Math.max(maxY, c.y + pad);
    }
  }
  return {
    x: Math.floor(minX - padding),
    y: Math.floor(minY - padding),
    width: Math.max(1, Math.ceil(maxX - minX + padding * 2)),
    height: Math.max(1, Math.ceil(maxY - minY + padding * 2)),
  };
}

function attrs(pairs: Record<string, string | number | undefined>): string {
  return Object.entries(pairs)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}="${escapeHtml(String(v))}"`)
    .join(" ");
}

/** Paint attributes shared by every shape. */
function paint(el: Element): Record<string, string | number | undefined> {
  return {
    fill: isPainted(el.fill) ? el.fill : "none",
    stroke: isPainted(el.stroke) ? el.stroke : undefined,
    "stroke-width": isPainted(el.stroke) ? el.strokeWidth : undefined,
    opacity: el.opacity === 100 ? undefined : (el.opacity / 100).toFixed(3),
  };
}

/** `transform` for a rotated element, about its own top-left. */
function transform(el: Element): string | undefined {
  return el.rotation ? `rotate(${el.rotation} ${el.x} ${el.y})` : undefined;
}

/** Line/arrow endpoints, absolute — same rule as the canvas. */
function endpoints(el: Element): [number, number, number, number] {
  const raw = (el.data.points ?? "").trim();
  if (raw) {
    const nums = raw.split(/[\s,]+/).map(Number);
    if (nums.length >= 4 && nums.every((n) => Number.isFinite(n))) {
      return [el.x + nums[0], el.y + nums[1], el.x + nums[2], el.y + nums[3]];
    }
  }
  return [el.x, el.y, el.x + el.width, el.y + el.height];
}

function shadowFilterId(el: Element): string {
  return `shadow-${el.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function shadowFilter(el: Element): string {
  const blur = el.shadowBlur ?? 0;
  return `<filter id="${shadowFilterId(el)}" x="-50%" y="-50%" width="200%" height="200%">` +
    `<feDropShadow dx="${el.shadowOffsetX ?? 0}" dy="${el.shadowOffsetY ?? 4}" ` +
    `stdDeviation="${(blur / 2).toFixed(2)}" flood-color="${escapeHtml(el.shadowColor ?? "rgba(0,0,0,0.3)")}"/></filter>`;
}

/** One element as an SVG node. Returns "" for anything unrenderable. */
export function elementToSvgNode(el: Element, options: SvgOptions = {}): string {
  const filter = (el.shadowBlur ?? 0) > 0 ? `url(#${shadowFilterId(el)})` : undefined;
  const common = { transform: transform(el), filter };

  switch (el.data.kind) {
    case "rect": {
      const r = Math.max(0, Math.min(el.cornerRadius ?? 0, Math.min(el.width, el.height) / 2));
      return `<rect ${attrs({ x: el.x, y: el.y, width: el.width, height: el.height, rx: r || undefined, ry: r || undefined, ...paint(el), ...common })}/>`;
    }
    case "circle": {
      // The canvas builds a Circle with radius = width / 2 anchored top-left.
      const r = el.width / 2;
      return `<circle ${attrs({ cx: el.x + r, cy: el.y + r, r, ...paint(el), ...common })}/>`;
    }
    case "line":
    case "arrow": {
      const [x1, y1, x2, y2] = endpoints(el);
      const colour = isPainted(el.stroke) ? el.stroke : "#111111";
      const width = Math.max(1, el.strokeWidth || 2);
      const opacity = el.opacity === 100 ? undefined : (el.opacity / 100).toFixed(3);
      const line = `<line ${attrs({ x1, y1, x2, y2, stroke: colour, "stroke-width": width, "stroke-linecap": "round", opacity, ...common })}/>`;
      if (el.data.kind === "line") return line;
      const size = Math.max(8, width * 3.5);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const tip = (len: number, spread: number) =>
        `${(x2 - len * Math.cos(angle) + spread * Math.cos(angle + Math.PI / 2)).toFixed(2)},` +
        `${(y2 - len * Math.sin(angle) + spread * Math.sin(angle + Math.PI / 2)).toFixed(2)}`;
      const head = `<polygon ${attrs({ points: `${x2},${y2} ${tip(size, size * 0.42)} ${tip(size, -size * 0.42)}`, fill: colour, opacity, ...common })}/>`;
      return line + head;
    }
    case "path": {
      const d = el.data.points ?? "";
      if (!d) return "";
      return `<g ${attrs({ transform: `translate(${el.x} ${el.y})${el.rotation ? ` rotate(${el.rotation})` : ""}`, filter })}>` +
        `<path ${attrs({ d, fill: "none", stroke: isPainted(el.stroke) ? el.stroke : "#111111", "stroke-width": Math.max(1, el.strokeWidth || 2), "stroke-linecap": "round", "stroke-linejoin": "round", opacity: el.opacity === 100 ? undefined : (el.opacity / 100).toFixed(3) })}/></g>`;
    }
    case "text": {
      const size = el.data.fontSize ?? 24;
      const lines = (el.data.content ?? "").split("\n");
      // Fabric's default line height is 1.16em and it draws the first line's TOP
      // at `top`; SVG places the baseline, so drop by roughly the ascender.
      const lineHeight = size * 1.16;
      const align = el.data.text_align ?? "left";
      const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
      const x = align === "center" ? el.x + el.width / 2 : align === "right" ? el.x + el.width : el.x;
      const vertical = el.data.vertical_align ?? "top";
      const block = lines.length * lineHeight;
      const offset =
        vertical === "middle" ? Math.max(0, (el.height - block) / 2) :
        vertical === "bottom" ? Math.max(0, el.height - block) : 0;
      const tspans = lines
        .map((line, i) =>
          `<tspan ${attrs({ x, y: (el.y + offset + lineHeight * i + size * 0.8).toFixed(2) })}>${escapeHtml(line)}</tspan>`,
        )
        .join("");
      return `<text ${attrs({
        "font-family": el.data.fontFamily ?? "sans-serif",
        "font-size": size,
        "font-weight": el.data.bold ? "bold" : undefined,
        "font-style": el.data.italic ? "italic" : undefined,
        "text-anchor": anchor === "start" ? undefined : anchor,
        fill: isPainted(el.fill) ? el.fill : "#111111",
        stroke: isPainted(el.stroke) ? el.stroke : undefined,
        "stroke-width": isPainted(el.stroke) ? el.strokeWidth : undefined,
        "paint-order": isPainted(el.stroke) ? "stroke" : undefined,
        opacity: el.opacity === 100 ? undefined : (el.opacity / 100).toFixed(3),
        ...common,
      })}>${tspans}</text>`;
    }
    case "image":
    case "svg": {
      const href = options.imageData?.[el.id];
      // No bytes to embed: emit the placeholder box rather than a dead link.
      if (!href) {
        return `<rect ${attrs({ x: el.x, y: el.y, width: el.width, height: el.height, fill: "#e8e8e8", stroke: "#cccccc", "stroke-width": 1, ...common })}/>`;
      }
      return `<image ${attrs({ x: el.x, y: el.y, width: el.width, height: el.height, href, preserveAspectRatio: "none", opacity: el.opacity === 100 ? undefined : (el.opacity / 100).toFixed(3), ...common })}/>`;
    }
    default:
      return "";
  }
}

/** Elements → a complete `<svg>` document, sorted back-to-front. */
export function elementsToSvg(elements: Element[], options: SvgOptions = {}): string {
  const sorted = [...elements].sort((a, b) => a.layerIndex - b.layerIndex);
  const box = boundsOf(sorted, options.padding ?? 0);
  const defs = sorted.filter((el) => (el.shadowBlur ?? 0) > 0).map(shadowFilter).join("");
  const background = options.background
    ? `<rect ${attrs({ x: box.x, y: box.y, width: box.width, height: box.height, fill: options.background })}/>`
    : "";
  const body = sorted.map((el) => elementToSvgNode(el, options)).join("\n  ");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${box.width}" height="${box.height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}">\n` +
    (defs ? `  <defs>${defs}</defs>\n` : "") +
    (background ? `  ${background}\n` : "") +
    `  ${body}\n</svg>`
  );
}

/** Rasterises SVG markup to a PNG data URL at `scale`× its natural size. */
export function svgToPngDataUrl(svg: string, width: number, height: number, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get a 2D context for the export"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    // A tainted or malformed document rejects rather than hanging the caller.
    img.onerror = () => reject(new Error("Could not rasterise the SVG export"));
    img.src = url;
  });
}
