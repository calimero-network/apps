import { describe, expect, it } from "vitest";
import {
  anchorPoint, canBind, connectorGeometry, detachMoved, nearestAnchor, parseBinding, reroute, shapeUnder,
} from "./connectors";
import type { Element } from "../types";

function el(over: Partial<Element> & { id: string }): Element {
  return {
    data: { kind: "rect" }, x: 0, y: 0, width: 100, height: 50, rotation: 0,
    fill: "transparent", stroke: "#000", strokeWidth: 4, opacity: 100, layerIndex: 0,
    createdBy: "", createdAt: 1, updatedAt: 1, ...over,
  } as Element;
}

const A = el({ id: "A", x: 0, y: 0 });
const B = el({ id: "B", x: 300, y: 100, layerIndex: 1 });

describe("anchors", () => {
  it("are the midpoints of the four edges", () => {
    expect(anchorPoint(A, "top")).toEqual({ x: 50, y: 0 });
    expect(anchorPoint(A, "right")).toEqual({ x: 100, y: 25 });
    expect(anchorPoint(A, "bottom")).toEqual({ x: 50, y: 50 });
    expect(anchorPoint(A, "left")).toEqual({ x: 0, y: 25 });
  });

  it("rotate with the shape about its top-left", () => {
    const p = anchorPoint({ ...A, rotation: 90 }, "right");
    expect(p.x).toBeCloseTo(-25);
    expect(p.y).toBeCloseTo(100);
  });

  it("only area shapes accept a dock", () => {
    expect(canBind(A)).toBe(true);
    expect(canBind(el({ id: "l", data: { kind: "line" } }))).toBe(false);
    expect(canBind(el({ id: "t", data: { kind: "text", content: "x" } }))).toBe(false);
    expect(canBind(el({ id: "s", data: { kind: "text" }, box: "sticky" }))).toBe(true);
    expect(canBind(el({ id: "p", data: { kind: "path", points: "M0 0" } }))).toBe(false);
    expect(canBind(el({ id: "st", data: { kind: "path", points: "M0 0" }, shape: "star" }))).toBe(true);
  });
});

describe("nearestAnchor", () => {
  it("snaps within the radius and not beyond it", () => {
    expect(nearestAnchor([A, B], { x: 104, y: 27 }, 14)).toMatchObject({ id: "A", side: "right", x: 100, y: 25 });
    expect(nearestAnchor([A, B], { x: 150, y: 27 }, 14)).toBeNull();
  });

  it("skips excluded shapes (a connector never docks both ends to one box)", () => {
    expect(nearestAnchor([A], { x: 100, y: 25 }, 14, new Set(["A"]))).toBeNull();
  });

  it("shapeUnder picks the topmost shape containing the point", () => {
    const over = el({ id: "C", x: 20, y: 10, layerIndex: 5 });
    expect(shapeUnder([A, over], { x: 30, y: 20 }, 0)?.id).toBe("C");
    expect(shapeUnder([A, over], { x: 500, y: 500 }, 0)).toBeNull();
  });
});

describe("bindings", () => {
  it("parse and reject junk", () => {
    expect(parseBinding("abc-1:left")).toEqual({ id: "abc-1", side: "left" });
    expect(parseBinding("abc")).toBeNull();
    expect(parseBinding("abc:middle")).toBeNull();
  });

  const geo = connectorGeometry(anchorPoint(A, "right"), anchorPoint(B, "left"));
  const arrow = el({
    id: "L", data: { kind: "arrow", points: geo.points }, x: geo.x, y: geo.y, width: geo.width, height: geo.height,
    startBinding: "A:right", endBinding: "B:left",
  });

  it("a connector already on its anchors needs no reroute (no write loop)", () => {
    expect(reroute([A, B, arrow])).toEqual([]);
  });

  it("moving a docked shape reroutes the connector to its new anchor", () => {
    const moved = { ...B, x: 400, y: 300 };
    const [out] = reroute([A, moved, arrow], 42);
    expect(out.id).toBe("L");
    expect(out.updatedAt).toBe(42);
    const nums = out.data.points!.split(/[\s,]+/).map(Number);
    expect({ x: out.x + nums[0], y: out.y + nums[1] }).toEqual({ x: 100, y: 25 });
    expect({ x: out.x + nums[2], y: out.y + nums[3] }).toEqual({ x: 400, y: 325 });
  });

  it("a deleted shape leaves its end where it was", () => {
    expect(reroute([A, arrow])).toEqual([]);
  });

  it("dragging the connector alone undocks it; moving it with its shapes keeps the docks", () => {
    const alone = detachMoved(arrow, new Set(["L"]));
    expect(alone.startBinding).toBeUndefined();
    expect(alone.endBinding).toBeUndefined();
    const together = detachMoved(arrow, new Set(["L", "A", "B"]));
    expect(together).toMatchObject({ startBinding: "A:right", endBinding: "B:left" });
  });
});
