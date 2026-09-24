import { describe, it, expect } from "vitest";
import type { Element } from "../types";
import starter from "../starter/starter-project.json";
import {
  elementsInScreen,
  fitScreen,
  isScreen,
  listScreens,
  nextScreenName,
  screenForSelection,
  screenLabel,
  screenToSvg,
} from "./screens";

function el(id: string, extra: Partial<Element> = {}): Element {
  return {
    id,
    data: { kind: "rect" },
    x: 0, y: 0, width: 100, height: 100,
    rotation: 0, fill: "#000000", stroke: "transparent", strokeWidth: 0, opacity: 100,
    layerIndex: 0,
    createdBy: "", createdAt: 0, updatedAt: 0,
    label: null,
    ...extra,
  };
}

const screen = (id: string, name: string, x: number, y: number, width = 400, height = 300, extra: Partial<Element> = {}) =>
  el(id, { label: `screen/${name}`, x, y, width, height, ...extra });

describe("what is a screen", () => {
  it("is a rect labelled directly in the screen group", () => {
    expect(isScreen(screen("a", "Home", 0, 0))).toBe(true);
    expect(isScreen(el("b", { label: "Screen/Home" }))).toBe(true);
  });

  it("is not a deeper layer that merely lives in a group called screen", () => {
    expect(isScreen(el("a", { label: "screen/header/logo" }))).toBe(false);
    expect(isScreen(el("b", { label: "screen" }))).toBe(false);
    expect(isScreen(el("c", { label: "card/screen" }))).toBe(false);
  });

  it("has an area: a text labelled like a screen is not one", () => {
    expect(isScreen(el("t", { label: "screen/Home", data: { kind: "text", content: "hi" } }))).toBe(false);
  });

  it("follows a local rename before the contract has caught up", () => {
    const plain = el("a", { label: "backdrop" });
    expect(listScreens([plain], { a: screenLabel("Now a screen") }).map((s) => s.name)).toEqual(["Now a screen"]);
  });

  it("finds the starter board's five screens, in order, with no migration", () => {
    const screens = listScreens(starter.elements as Element[]);
    expect(screens.map((s) => s.name)).toEqual([
      "01 Sign in", "02 Overview", "03 Invoice detail", "04 Settings", "05 Design system",
    ]);
    expect(screens[0]).toMatchObject({ width: 1440, height: 900 });
  });
});

describe("presentation order", () => {
  it("reads left to right across a row", () => {
    const board = [screen("c", "C", 1000, 0), screen("a", "A", 0, 0), screen("b", "B", 500, 10)];
    expect(listScreens(board).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("then top to bottom, row by row", () => {
    const board = [
      screen("d", "D", 500, 400), screen("c", "C", 0, 400),
      screen("b", "B", 500, 0), screen("a", "A", 0, 0),
    ];
    expect(listScreens(board).map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps a long page in the row it starts in", () => {
    // A 4000px landing page between two short screens must not push the third
    // screen into a row of its own below it.
    const board = [
      screen("a", "A", 0, 0, 400, 300),
      screen("long", "Long", 500, 20, 400, 4000),
      screen("b", "B", 1000, 0, 400, 300),
      screen("next", "Next row", 0, 5000),
    ];
    expect(listScreens(board).map((s) => s.id)).toEqual(["a", "long", "b", "next"]);
  });
});

describe("what a screen shows", () => {
  const home = screen("home", "Home", 0, 0, 400, 300, { layerIndex: 0 });
  const inside = el("inside", { x: 50, y: 50, width: 20, height: 20, layerIndex: 2 });
  const straddling = el("edge", { x: 380, y: 100, width: 60, height: 20, layerIndex: 1 });
  const outside = el("away", { x: 900, y: 900, layerIndex: 3 });

  it("is everything painted inside its area, back to front — including what straddles the edge", () => {
    const shown = elementsInScreen([outside, inside, straddling, home], listScreens([home])[0]);
    expect(shown.map((e) => e.id)).toEqual(["home", "edge", "inside"]);
  });

  it("is clipped to the screen: the SVG viewport is the screen, not the content", () => {
    const s = listScreens([home])[0];
    const svg = screenToSvg([home, inside, straddling, outside], s, { background: "#ffffff" });
    expect(svg).toContain('viewBox="0 0 400 300"');
    expect(svg).toContain('width="400" height="300"');
    expect(svg).not.toContain('x="900"');
  });

  it("starts from the screen the selection is on", () => {
    const other = screen("other", "Other", 1000, 0);
    const screens = listScreens([home, other]);
    expect(screenForSelection(screens, [inside])?.id).toBe("home");
    expect(screenForSelection(screens, [other])?.id).toBe("other");
    expect(screenForSelection(screens, [outside])).toBeUndefined();
    expect(screenForSelection(screens, [])).toBeUndefined();
  });
});

describe("fitting a screen to the window", () => {
  it("shows a slide whole", () => {
    const fit = fitScreen(1440, 900, 1280, 720);
    expect(fit.scale).toBeCloseTo(0.8);
    expect(fit.scrolls).toBe(false);
  });

  it("shows a phone screen whole rather than at 100% with a scrollbar", () => {
    const fit = fitScreen(375, 812, 1280, 720);
    expect(fit.scale).toBeCloseTo(720 / 812);
    expect(fit.scrolls).toBe(false);
  });

  it("scrolls a long page at a readable width instead of shrinking it to a strip", () => {
    const fit = fitScreen(1440, 4000, 1280, 720);
    expect(fit.scale).toBeCloseTo(1280 / 1440);
    expect(fit.scrolls).toBe(true);
  });

  it("never enlarges a long narrow page past 100% to fill the width", () => {
    const fit = fitScreen(375, 3000, 1280, 720);
    expect(fit.scale).toBe(1);
    expect(fit.scrolls).toBe(true);
  });

  it("honours an explicit zoom", () => {
    expect(fitScreen(1440, 900, 1280, 720, "actual")).toEqual({ scale: 1, scrolls: true });
    expect(fitScreen(1440, 900, 1280, 720, "width").scale).toBeCloseTo(1280 / 1440);
  });
});

describe("naming", () => {
  it("takes the first free Screen N", () => {
    const screens = listScreens([screen("a", "Screen 1", 0, 0), screen("b", "screen 3", 500, 0)]);
    expect(nextScreenName(screens)).toBe("Screen 2");
  });

  it("keeps the separator out of a screen's name", () => {
    expect(screenLabel("A/B")).toBe("screen/A-B");
  });
});
