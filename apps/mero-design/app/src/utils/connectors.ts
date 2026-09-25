import type { Element } from "../types";
import { isShapeKind } from "./shapes";

/**
 * Lines and arrows docked to shapes — the connectors of a flowchart or a UML
 * diagram.
 *
 * Every shape offers four anchors, the midpoint of each edge. A line or arrow
 * drawn from or to near one snaps to it and remembers the attachment as
 * `startBinding` / `endBinding` ("<element id>:<side>", carried in the label
 * like the other client-side extras — see elementMeta). Whenever a docked shape
 * moves or resizes, `reroute` recomputes the connector's endpoints from the
 * anchors, so the connection follows the box instead of being left behind.
 *
 * The anchor is stored, not re-chosen on every move: a UML association drawn
 * from the right side of one class to the left side of another stays exactly
 * that when either box is dragged around.
 */

export type Side = "top" | "right" | "bottom" | "left";
export const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

export interface Binding {
  id: string;
  side: Side;
}

export interface Anchor extends Binding {
  x: number;
  y: number;
}

export function parseBinding(raw: string | null | undefined): Binding | null {
  if (!raw) return null;
  const at = raw.lastIndexOf(":");
  if (at <= 0) return null;
  const side = raw.slice(at + 1) as Side;
  if (!SIDES.includes(side)) return null;
  return { id: raw.slice(0, at), side };
}

export function formatBinding(b: Binding): string {
  return `${b.id}:${b.side}`;
}

export function isConnector(el: Element): boolean {
  return el.data.kind === "line" || el.data.kind === "arrow";
}

/** Shapes a connector can dock to: anything with an area. */
export function canBind(el: Element): boolean {
  switch (el.data.kind) {
    case "rect":
    case "circle":
    case "image":
    case "svg":
      return true;
    case "path":
      return isShapeKind(el.shape);
    case "text":
      return el.box === "box" || el.box === "sticky";
    default:
      return false;
  }
}

/** The midpoint of one edge, rotated with the element about its top-left. */
export function anchorPoint(el: Element, side: Side): { x: number; y: number } {
  const local =
    side === "top" ? { x: el.width / 2, y: 0 } :
    side === "right" ? { x: el.width, y: el.height / 2 } :
    side === "bottom" ? { x: el.width / 2, y: el.height } :
    { x: 0, y: el.height / 2 };
  const rad = ((el.rotation ?? 0) * Math.PI) / 180;
  if (!rad) return { x: el.x + local.x, y: el.y + local.y };
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: el.x + local.x * cos - local.y * sin,
    y: el.y + local.x * sin + local.y * cos,
  };
}

export function anchorsOf(el: Element): Anchor[] {
  return SIDES.map((side) => ({ id: el.id, side, ...anchorPoint(el, side) }));
}

/**
 * The anchor nearest `p` within `radius`, over every bindable element not in
 * `exclude`. Topmost wins a tie, so the shape the user sees is the one docked.
 */
export function nearestAnchor(
  elements: Element[],
  p: { x: number; y: number },
  radius: number,
  exclude: ReadonlySet<string> = new Set(),
): Anchor | null {
  let best: Anchor | null = null;
  let bestD = radius;
  let bestLayer = -Infinity;
  for (const el of elements) {
    if (exclude.has(el.id) || !canBind(el)) continue;
    for (const a of anchorsOf(el)) {
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d < bestD - 0.001 || (Math.abs(d - bestD) <= 0.001 && el.layerIndex > bestLayer)) {
        best = a;
        bestD = d;
        bestLayer = el.layerIndex;
      }
    }
  }
  return best;
}

/**
 * The shape whose box (grown by `margin`) contains `p` — whose anchors to show
 * while a connector tool hovers. Topmost first.
 */
export function shapeUnder(elements: Element[], p: { x: number; y: number }, margin: number): Element | null {
  const hits = elements.filter(
    (el) =>
      canBind(el) &&
      p.x >= el.x - margin && p.x <= el.x + el.width + margin &&
      p.y >= el.y - margin && p.y <= el.y + el.height + margin,
  );
  if (hits.length === 0) return null;
  return hits.reduce((top, el) => (el.layerIndex > top.layerIndex ? el : top));
}

/** A connector's geometry for absolute endpoints: box + element-local points. */
export function connectorGeometry(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Pick<Element, "x" | "y" | "width" | "height"> & { points: string } {
  const x = Math.round(Math.min(a.x, b.x));
  const y = Math.round(Math.min(a.y, b.y));
  return {
    x,
    y,
    width: Math.round(Math.abs(b.x - a.x)),
    height: Math.round(Math.abs(b.y - a.y)),
    points: `${Math.round(a.x) - x},${Math.round(a.y) - y} ${Math.round(b.x) - x},${Math.round(b.y) - y}`,
  };
}

/** A connector's current absolute endpoints, from its stored points. */
export function endpointsOf(el: Element): [{ x: number; y: number }, { x: number; y: number }] {
  const nums = (el.data.points ?? "").trim().split(/[\s,]+/).map(Number);
  if (nums.length >= 4 && nums.every((n) => Number.isFinite(n))) {
    return [{ x: el.x + nums[0], y: el.y + nums[1] }, { x: el.x + nums[2], y: el.y + nums[3] }];
  }
  return [{ x: el.x, y: el.y }, { x: el.x + el.width, y: el.y + el.height }];
}

/**
 * Where a connector's ends should be, given where its docked shapes are now.
 * `overrides` lets the canvas ask about shapes mid-drag, before they are saved.
 */
export function routedEndpoints(
  connector: Element,
  byId: ReadonlyMap<string, Element>,
): [{ x: number; y: number }, { x: number; y: number }] {
  const [start, end] = endpointsOf(connector);
  const sb = parseBinding(connector.startBinding);
  const eb = parseBinding(connector.endBinding);
  const s = sb && byId.get(sb.id);
  const e = eb && byId.get(eb.id);
  return [s ? anchorPoint(s, sb!.side) : start, e ? anchorPoint(e, eb!.side) : end];
}

/**
 * Every docked connector whose stored endpoints no longer match its shapes,
 * updated. Empty when everything is in place — which is what stops this from
 * looping, and what makes two peers rerouting the same move agree byte for byte.
 */
export function reroute(elements: Element[], now = Date.now()): Element[] {
  const byId = new Map(elements.map((el) => [el.id, el] as const));
  const out: Element[] = [];
  for (const el of elements) {
    if (!isConnector(el) || (!el.startBinding && !el.endBinding)) continue;
    const [a, b] = routedEndpoints(el, byId);
    const geo = connectorGeometry(a, b);
    if (
      geo.x === el.x && geo.y === el.y &&
      geo.width === el.width && geo.height === el.height &&
      geo.points === (el.data.points ?? "")
    ) continue;
    const { points, ...box } = geo;
    out.push({ ...el, ...box, data: { ...el.data, points }, updatedAt: now });
  }
  return out;
}

/**
 * Drop the bindings of a connector the user moved on its own: dragging an arrow
 * away from a box means "not connected any more". A binding to a shape that
 * moved along with it (both in one selection) is kept — moving a whole diagram
 * must not come apart.
 */
export function detachMoved(connector: Element, movedIds: ReadonlySet<string>): Element {
  const next = { ...connector };
  const sb = parseBinding(connector.startBinding);
  const eb = parseBinding(connector.endBinding);
  if (sb && !movedIds.has(sb.id)) delete next.startBinding;
  if (eb && !movedIds.has(eb.id)) delete next.endBinding;
  return next;
}
