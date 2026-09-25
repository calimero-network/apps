import { describe, expect, it } from "vitest";
import { inkOf, isBoxText, layoutBox, newSticky, rectToBox, wrapLines } from "./boxText";
import type { Element } from "../types";

/** 10 units per character: easy arithmetic. */
const mono = (s: string) => s.length * 10;

const rect: Element = {
  id: "r1", data: { kind: "rect" }, x: 5, y: 6, width: 200, height: 100, rotation: 0,
  fill: "#1971c2", stroke: "#1e1e1e", strokeWidth: 4, opacity: 100, layerIndex: 3,
  createdBy: "me", createdAt: 1, updatedAt: 1, cornerRadius: 8, label: "cards/Card",
};

describe("wrapLines", () => {
  it("wraps at word boundaries", () => {
    expect(wrapLines("aaa bbb ccc", 70, mono)).toEqual(["aaa bbb", "ccc"]);
  });

  it("keeps explicit newlines and blank lines", () => {
    expect(wrapLines("one\n\ntwo", 1000, mono)).toEqual(["one", "", "two"]);
  });

  it("breaks a word wider than the box instead of spilling out", () => {
    expect(wrapLines("abcdefghij", 40, mono)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("keeps a paragraph's indentation", () => {
    expect(wrapLines("  x", 1000, mono)).toEqual(["  x"]);
  });
});

describe("layoutBox", () => {
  const box = { ...rectToBox(rect), data: { ...rectToBox(rect).data, content: "hi", fontSize: 20 } };

  it("middle/center is the default for text put in a rectangle", () => {
    const l = layoutBox(box, 200, 100, mono);
    expect(l.align).toBe("center");
    expect(l.anchorX).toBe(100);
    expect(l.top).toBeCloseTo((100 - 25) / 2);
  });

  it("top/left and bottom/right respect the padding", () => {
    const tl = layoutBox({ ...box, data: { ...box.data, text_align: "left", vertical_align: "top" } }, 200, 100, mono);
    expect(tl.anchorX).toBe(10);
    expect(tl.top).toBe(10);
    const br = layoutBox({ ...box, data: { ...box.data, text_align: "right", vertical_align: "bottom" } }, 200, 100, mono);
    expect(br.anchorX).toBe(190);
    expect(br.top).toBe(100 - 10 - 25);
  });

  it("reports the height the text needs, for auto-grow", () => {
    const many = { ...box, data: { ...box.data, content: "a\nb\nc\nd\ne" } };
    expect(layoutBox(many, 200, 100, mono).neededHeight).toBe(Math.ceil(5 * 25 + 20));
  });
});

describe("constructors", () => {
  it("rectToBox keeps id, geometry, paint, corners and group label", () => {
    const box = rectToBox(rect, 99);
    expect(box).toMatchObject({
      id: "r1", x: 5, y: 6, width: 200, height: 100, fill: "#1971c2", stroke: "#1e1e1e",
      strokeWidth: 4, cornerRadius: 8, label: "cards/Card", layerIndex: 3, box: "box", updatedAt: 99,
    });
    expect(box.data.kind).toBe("text");
    expect(isBoxText(box)).toBe(true);
    expect(isBoxText(rect)).toBe(false);
  });

  it("a new sticky is a 200px yellow note centred on the click", () => {
    const s = newSticky("s1", 300, 300, 7);
    expect(s).toMatchObject({ x: 200, y: 200, width: 200, height: 200, box: "sticky", layerIndex: 7 });
    expect(s.fill).toBe("#FFE27A");
    expect(s.shadowBlur).toBeGreaterThan(0);
  });

  it("text colour is chosen for contrast unless set", () => {
    const box = rectToBox(rect);
    expect(inkOf(box)).toBe("#ffffff");
    expect(inkOf({ ...box, textColor: "#ff0000" })).toBe("#ff0000");
    expect(inkOf(newSticky("s", 0, 0, 0))).toBe("#1e1e1e");
  });
});
