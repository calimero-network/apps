import type { Element } from "../types";
import { boundsOf, elementsToSvg, type Bounds } from "./svgExport";
import { labelFor, sanitizeName, splitPath, SCREEN_ORDER_SUFFIX, type LabelPatch } from "./groups";

/**
 * Screens — the unit presentation mode plays, Figma's top-level frame.
 *
 * A screen is a **region**, not a list of members: a rect whose label sits
 * directly in the top-level `screen` group (`"screen/01 Sign in"`), and whose
 * bounds are the slide. Everything painted inside those bounds is on the slide,
 * clipped at its edge — exactly what a Figma frame does, and exactly what the
 * bundled starter board was already authored as (its four screens are backdrop
 * rects labelled `screen/…`, with their contents laid on top unlabelled). So the
 * starter presents with no migration, and so does any board built the same way.
 *
 * Riding the label is the same trade groups made (see `groups.ts`): no new
 * contract method, no state-layout change, and every peer sees the same screens
 * because they live in contract state. It also means a screen cannot be empty
 * of a backdrop — the rect IS the screen.
 *
 * Order. By default screens play in reading order across the board. Once
 * someone drags them into a different order in the Screens tab, each screen's
 * place is written onto the end of its name — `screen/Home @3` — and that wins.
 * The suffix is hidden everywhere a name is shown. Being a label, it syncs to
 * every member like any rename; two people reordering at once can leave two
 * screens with the same number, which then fall back to reading order between
 * themselves rather than failing.
 *
 * Why a region and not "the elements I selected": a slide is judged by what it
 * shows. A member list goes stale the moment someone drops a new layer onto the
 * screen, and would render an element that was dragged off it. Bounds cannot
 * drift from what the canvas shows.
 */

/** The top-level group every screen lives in. Matched case-insensitively. */
export const SCREEN_GROUP = "screen";

export interface Screen {
  /** Id of the backdrop rect that defines the screen. */
  id: string;
  name: string;
  /** Explicit place in the presentation (1-based), or null for reading order. */
  order: number | null;
  /** The label this screen was read from, with any local override applied. */
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  element: Element;
}

/** Label for a screen called `name`, optionally at an explicit place. */
export function screenLabel(name: string, order: number | null = null): string {
  const base = labelFor(SCREEN_GROUP, name.replace(SCREEN_ORDER_SUFFIX, ""));
  return order === null ? base : `${base} @${order}`;
}

/** A screen label's last segment → the name to show, and its order if any. */
export function parseScreenName(segment: string): { name: string; order: number | null } {
  const m = segment.match(SCREEN_ORDER_SUFFIX);
  if (!m) return { name: segment, order: null };
  const name = segment.slice(0, m.index).trim();
  return { name: name || segment, order: name ? Number(m[1]) : null };
}

/**
 * True when this element defines a screen: a rect labelled exactly
 * `screen/<name>`. Deeper paths (`screen/header/logo`) are ordinary layers that
 * merely live in a group of that name, and a text labelled `screen/…` has no
 * area to present.
 */
export function isScreen(el: Element, labelOverride?: string): boolean {
  if (el.data.kind !== "rect") return false;
  const segments = splitPath(labelOverride ?? el.label);
  return segments.length === 2 && segments[0].toLowerCase() === SCREEN_GROUP;
}

function toScreen(el: Element, label: string): Screen {
  const { name, order } = parseScreenName(splitPath(label)[1] ?? "Screen");
  return {
    id: el.id,
    name,
    order,
    label,
    x: el.x,
    y: el.y,
    width: Math.max(1, el.width),
    height: Math.max(1, el.height),
    element: el,
  };
}

/**
 * Presentation order: reading order across the board — rows top to bottom,
 * left to right inside a row. Figma, with no prototype flow, walks top-level
 * frames by position too, and it means the order is something everyone can see
 * and change by moving a screen, rather than a hidden number.
 *
 * A screen joins the current row when its top is above the middle of the row's
 * first screen. That keeps a long scrolling page beside three short ones in the
 * same row, instead of pushing everything after it into a row of its own.
 */
export function orderScreens(screens: Screen[]): Screen[] {
  const byTop = [...screens].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Screen[][] = [];
  for (const s of byTop) {
    const row = rows[rows.length - 1];
    if (row && s.y < row[0].y + row[0].height / 2) row.push(s);
    else rows.push([s]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x || a.y - b.y));
}

/**
 * Every screen on the board, in presentation order: explicitly numbered
 * screens first, by number, then any without a number in reading order — which
 * is where a screen someone just made on another client lands.
 */
export function listScreens(
  elements: Element[],
  labelOverrides: Record<string, string> = {},
): Screen[] {
  const out: Screen[] = [];
  for (const el of elements) {
    const label = labelOverrides[el.id] ?? el.label ?? "";
    if (isScreen(el, label)) out.push(toScreen(el, label));
  }
  const reading = orderScreens(out);
  const rank = new Map(reading.map((s, i) => [s.id, i]));
  return reading.sort((a, b) => {
    if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
    if ((a.order === null) !== (b.order === null)) return a.order === null ? 1 : -1;
    return rank.get(a.id)! - rank.get(b.id)!;
  });
}

/**
 * Moves the screen at `from` to `to` and numbers every screen 1…n in the new
 * order. Only labels that actually change are returned, so a move within an
 * already-numbered deck touches just the screens whose place changed — and a
 * move to where it already is writes nothing, rather than numbering a deck
 * that was never numbered.
 */
export function reorderScreens(screens: Screen[], from: number, to: number): LabelPatch {
  if (from < 0 || from >= screens.length) return {};
  const target = Math.max(0, Math.min(screens.length - 1, to));
  if (target === from) return {};
  const next = [...screens];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  const patch: LabelPatch = {};
  next.forEach((s, i) => {
    const label = screenLabel(s.name, i + 1);
    if (label !== s.label) patch[s.id] = label;
  });
  return patch;
}

/** The number a new screen takes: after the last one, once the deck is numbered. */
export function nextScreenOrder(screens: Screen[]): number | null {
  const numbered = screens.map((s) => s.order).filter((o): o is number => o !== null);
  return numbered.length === 0 ? null : Math.max(...numbered) + 1;
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Every element painted at least partly inside the screen, back to front. */
export function elementsInScreen(elements: Element[], screen: Screen): Element[] {
  return elements
    .filter((el) => intersects(boundsOf([el]), screen))
    .sort((a, b) => a.layerIndex - b.layerIndex);
}

/** The screen a point falls in — the front-most one when screens overlap. */
export function screenAt(screens: Screen[], x: number, y: number): Screen | undefined {
  return [...screens]
    .sort((a, b) => b.element.layerIndex - a.element.layerIndex)
    .find((s) => x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height);
}

/** The screen to start presenting from, given what is selected. */
export function screenForSelection(screens: Screen[], selected: Element[]): Screen | undefined {
  for (const el of selected) {
    const own = screens.find((s) => s.id === el.id);
    if (own) return own;
  }
  const first = selected[0];
  if (!first) return undefined;
  return screenAt(screens, first.x + first.width / 2, first.y + first.height / 2);
}

/** One screen as a standalone SVG document, clipped to the screen's bounds. */
export function screenToSvg(
  elements: Element[],
  screen: Screen,
  options: { background?: string; imageData?: Record<string, string> } = {},
): string {
  return elementsToSvg(elementsInScreen(elements, screen), {
    ...options,
    bounds: { x: screen.x, y: screen.y, width: screen.width, height: screen.height },
  });
}

export type FitMode = "fit" | "width" | "actual";

export interface Fit {
  scale: number;
  /** True when the screen is taller than the viewport at this scale. */
  scrolls: boolean;
}

/**
 * How big to draw a screen in a `viewW × viewH` viewport.
 *
 *   fit     the whole screen, as large as it goes — unless that would shrink a
 *           long page to an unreadable strip, in which case it fills the width
 *           (never enlarging past 100%) and scrolls. That is the Figma
 *           behaviour for a frame taller than the device.
 *   width   always fill the width, scroll whatever is left.
 *   actual  100%.
 */
export function fitScreen(
  width: number,
  height: number,
  viewW: number,
  viewH: number,
  mode: FitMode = "fit",
): Fit {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const vw = Math.max(1, viewW);
  const vh = Math.max(1, viewH);
  const widthScale = vw / w;
  let scale: number;
  if (mode === "actual") {
    scale = 1;
  } else if (mode === "width") {
    scale = widthScale;
  } else {
    const whole = Math.min(widthScale, vh / h);
    // Half the size it would have at a readable width is where "see it all"
    // stops being worth it.
    const readable = Math.min(widthScale, 1);
    scale = whole >= readable / 2 ? whole : readable;
  }
  return { scale, scrolls: h * scale > vh + 0.5 };
}

/** "Screen 1", "Screen 2", … — the first free name among existing screens. */
export function nextScreenName(screens: Screen[]): string {
  const taken = new Set(screens.map((s) => s.name.toLowerCase()));
  for (let i = 1; ; i++) {
    const candidate = `Screen ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** A name safe to put in a label, or the fallback when nothing is left. */
export function cleanScreenName(name: string, fallback: string): string {
  return sanitizeName(name) || fallback;
}
