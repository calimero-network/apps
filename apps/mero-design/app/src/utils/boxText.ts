import type { Element } from "../types";
import { inkFor, STICKY_COLORS, STICKY_SIZE } from "./shapes";

/**
 * Text inside a container — a rectangle you can type into, and sticky notes.
 *
 * Both are `text` elements with `box` set (see `types`): `fill`, `stroke` and
 * `cornerRadius` paint the container and the words are laid out inside it,
 * aligned by `text_align` and `vertical_align` like a Figma frame. That keeps
 * the whole thing one element, so moving, resizing, grouping and syncing need
 * no linking between two objects that could drift apart.
 *
 * The layout lives here, not in the canvas, because the SVG export (and with it
 * Present mode, merge-into-image and the project previews) must wrap the text
 * at exactly the same points the canvas does.
 */

export const LINE_HEIGHT = 1.25;

/** Inner padding, by container kind. A sticky breathes more. */
export function paddingOf(el: Pick<Element, "box">): number {
  return el.box === "sticky" ? 16 : 10;
}

export function isBoxText(el: Element): boolean {
  return el.data.kind === "text" && (el.box === "box" || el.box === "sticky");
}

/** The colour the words are painted in. */
export function inkOf(el: Element): string {
  return el.textColor || inkFor(el.fill && el.fill !== "transparent" ? el.fill : null);
}

/** A CSS/canvas `font` shorthand for the element's text. */
export function fontOf(el: Element): string {
  const size = el.data.fontSize ?? 16;
  const family = el.data.fontFamily ?? "sans-serif";
  return `${el.data.italic ? "italic " : ""}${el.data.bold ? "bold " : ""}${size}px ${family}`;
}

export type Measure = (text: string) => number;

/**
 * Word-wrap `text` into lines no wider than `maxWidth`. Explicit newlines are
 * kept; a single word wider than the box is broken by character, because a
 * sticky with a long URL must not spill out sideways.
 */
export function wrapLines(text: string, maxWidth: number, measure: Measure): string[] {
  const width = Math.max(1, maxWidth);
  const out: string[] = [];

  /** A word too wide for any line, cut into pieces that fit. */
  const breakWord = (word: string): string[] => {
    const chunks: string[] = [];
    let chunk = "";
    for (const ch of word) {
      if (chunk !== "" && measure(chunk + ch) > width) { chunks.push(chunk); chunk = ""; }
      chunk += ch;
    }
    chunks.push(chunk);
    return chunks;
  };

  for (const para of text.split("\n")) {
    let line = "";
    for (const token of para.split(/(\s+)/)) {
      if (token === "") continue;
      // Whitespace joins the line; it is trimmed off the end at a wrap, and kept
      // at the start of a paragraph so indentation survives.
      if (/^\s+$/.test(token)) { line += token; continue; }
      if (measure(line + token) <= width) { line += token; continue; }
      if (line.trim() !== "") out.push(line.trimEnd());
      line = "";
      if (measure(token) <= width) { line = token; continue; }
      const chunks = breakWord(token);
      out.push(...chunks.slice(0, -1));
      line = chunks[chunks.length - 1];
    }
    out.push(line.trimEnd());
  }
  return out;
}

export interface BoxLayout {
  lines: string[];
  lineHeight: number;
  /** Top of the first line, relative to the box's top edge. */
  top: number;
  /** Height the text needs, padding included — what an auto-grow resizes to. */
  neededHeight: number;
  /** x of each line's anchor, relative to the box's left edge. */
  anchorX: number;
  align: "left" | "center" | "right";
}

/** Where the words go inside a box of `width`×`height`. */
export function layoutBox(el: Element, width: number, height: number, measure: Measure): BoxLayout {
  const pad = paddingOf(el);
  const size = el.data.fontSize ?? 16;
  const lineHeight = size * LINE_HEIGHT;
  const lines = wrapLines(el.data.content ?? "", width - pad * 2, measure);
  const block = lines.length * lineHeight;
  const va = el.data.vertical_align ?? "top";
  const top =
    va === "middle" ? (height - block) / 2 :
    va === "bottom" ? height - pad - block :
    pad;
  const align = el.data.text_align ?? "left";
  const anchorX = align === "center" ? width / 2 : align === "right" ? width - pad : pad;
  return { lines, lineHeight, top, neededHeight: Math.ceil(block + pad * 2), anchorX, align };
}

/**
 * A text measurer. Uses a real 2D context when there is one; jsdom has none, so
 * tests fall back to an average-glyph estimate, which is deterministic.
 */
export function measurerFor(font: string, fontSize: number): Measure {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    if (typeof document !== "undefined") ctx = document.createElement("canvas").getContext("2d");
  } catch {
    ctx = null;
  }
  if (ctx) {
    ctx.font = font;
    const c = ctx;
    return (s) => c.measureText(s).width;
  }
  return (s) => s.length * fontSize * 0.55;
}

/* ── Constructors ──────────────────────────────────────────────────── */

/**
 * A rectangle turned into a text container, keeping everything it already had
 * — position, size, fill, border, corners, name, group. Same id: the contract's
 * `add_element` replaces the stored element, so peers see the rect become a box
 * rather than a delete and an add.
 */
export function rectToBox(rect: Element, now = Date.now()): Element {
  return {
    ...rect,
    data: {
      kind: "text",
      content: "",
      fontSize: 16,
      fontFamily: "sans-serif",
      bold: false,
      italic: false,
      text_align: "center",
      vertical_align: "middle",
    },
    box: "box",
    updatedAt: now,
  };
}

/** A new sticky note centred on (cx, cy). */
export function newSticky(id: string, cx: number, cy: number, layerIndex: number, now = Date.now()): Element {
  const size = STICKY_SIZE;
  return {
    id,
    data: {
      kind: "text",
      content: "",
      fontSize: 18,
      fontFamily: "sans-serif",
      bold: false,
      italic: false,
      text_align: "left",
      vertical_align: "top",
    },
    x: Math.round(cx - size / 2),
    y: Math.round(cy - size / 2),
    width: size,
    height: size,
    rotation: 0,
    fill: STICKY_COLORS[0].value,
    stroke: "transparent",
    strokeWidth: 0,
    opacity: 100,
    layerIndex,
    createdBy: "",
    createdAt: now,
    updatedAt: now,
    cornerRadius: 4,
    // A soft lift, so a sticky reads as paper on the board rather than a swatch.
    shadowColor: "rgba(0,0,0,0.18)",
    shadowOffsetX: 0,
    shadowOffsetY: 4,
    shadowBlur: 10,
    box: "sticky",
  };
}
