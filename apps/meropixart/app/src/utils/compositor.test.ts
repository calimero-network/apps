import { describe, it, expect, beforeEach } from "vitest";
import { composite } from "./compositor";
import { createCanvas } from "./raster";
import { imageDraws } from "../test/canvasStub";
import { makeGroup, makeLayer } from "../test/factories";
import type { Layer } from "../types";

// A source canvas per layer id, handed to the compositor through `opts.sources`
// (the same seam the showcase previews use) so nothing here touches the editor's
// global canvas registry.
const sources = new Map<string, HTMLCanvasElement>();

function pixels(id: string, w = 10, h = 10): HTMLCanvasElement {
  const c = createCanvas(w, h);
  sources.set(id, c);
  return c;
}

function run(layers: Layer[], opts: { background?: string; skipId?: string } = {}) {
  const out = composite(layers, 100, 100, {
    ...opts,
    sources: (id) => sources.get(id) ?? null,
    masks: () => null,
  });
  return { out, draws: imageDraws(out) };
}

beforeEach(() => sources.clear());

describe("composite", () => {
  it("returns a canvas at the document size", () => {
    const { out } = run([]);
    expect([out.width, out.height]).toEqual([100, 100]);
  });

  it("paints in ascending layerIndex, back to front", () => {
    const back = makeLayer({ id: "back", layerIndex: 0 });
    const front = makeLayer({ id: "front", layerIndex: 5 });
    pixels("back"); pixels("front");
    const { draws } = run([front, back]); // deliberately out of order
    expect(draws.map((d) => d.source)).toEqual([sources.get("back"), sources.get("front")]);
  });

  it("skips a layer by id (the drag-preview path)", () => {
    pixels("a"); pixels("b");
    const { draws } = run([makeLayer({ id: "a" }), makeLayer({ id: "b" })], { skipId: "a" });
    expect(draws).toHaveLength(1);
    expect(draws[0].source).toBe(sources.get("b"));
  });

  it("skips a layer with no pixels, and folders never draw themselves", () => {
    const { draws } = run([makeLayer({ id: "empty" }), makeGroup({ id: "g" })]);
    expect(draws).toHaveLength(0);
  });

  it("hides a layer inside a hidden folder", () => {
    pixels("child");
    const layers = [
      makeGroup({ id: "g", visible: false, layerIndex: 1 }),
      makeLayer({ id: "child", parentId: "g", layerIndex: 0 }),
    ];
    expect(run(layers).draws).toHaveLength(0);
  });

  it("multiplies opacity down the folder chain", () => {
    pixels("child");
    const layers = [
      makeGroup({ id: "outer", opacity: 50, layerIndex: 2 }),
      makeGroup({ id: "inner", parentId: "outer", opacity: 50, layerIndex: 1 }),
      makeLayer({ id: "child", parentId: "inner", opacity: 50, layerIndex: 0 }),
    ];
    const { draws } = run(layers);
    expect(draws[0].globalAlpha).toBeCloseTo(0.125, 5);
  });

  it("drops a layer whose inherited opacity reaches zero", () => {
    pixels("child");
    const layers = [
      makeGroup({ id: "g", opacity: 0, layerIndex: 1 }),
      makeLayer({ id: "child", parentId: "g", layerIndex: 0 }),
    ];
    expect(run(layers).draws).toHaveLength(0);
  });

  it("survives a parent cycle rather than looping forever", () => {
    pixels("a");
    const layers = [
      makeGroup({ id: "a", parentId: "b", layerIndex: 1 }),
      makeGroup({ id: "b", parentId: "a", layerIndex: 0 }),
    ];
    expect(() => run(layers)).not.toThrow();
  });

  it("maps the blend mode onto the composite operation", () => {
    pixels("a");
    const { draws } = run([makeLayer({ id: "a", blendMode: "multiply" })]);
    expect(draws[0].globalCompositeOperation).toBe("multiply");
  });

  it("passes non-destructive adjustments through as a CSS filter", () => {
    pixels("a");
    const { draws } = run([makeLayer({
      id: "a",
      adjustments: { brightness: 50, contrast: 0, saturation: 0, hue: 90, exposure: 0, blur: 3, invert: true },
    })]);
    expect(draws[0].filter).toContain("hue-rotate(90deg)");
    expect(draws[0].filter).toContain("blur(3px)");
    expect(draws[0].filter).toContain("invert(1)");
  });

  it("applies the layer's own transform matrix, mirror included", () => {
    pixels("a", 40, 20);
    const { draws } = run([makeLayer({ id: "a", x: 10, y: 5, width: 40, height: 20, flipH: true })]);
    // flipH mirrors about the centre: a = −1, and the origin shifts to the right edge
    expect(draws[0].transform[0]).toBeCloseTo(-1, 6);
    expect(draws[0].transform[4]).toBeCloseTo(50, 6);
    expect(draws[0].transform[5]).toBeCloseTo(5, 6);
  });

  it("draws a warped layer as many triangles instead of one image", () => {
    pixels("plain", 40, 40);
    pixels("bent", 40, 40);
    const plain = run([makeLayer({ id: "plain", width: 40, height: 40 })]);
    const bent = run([makeLayer({
      id: "bent", width: 40, height: 40,
      warp: '{"tl":[8,0],"tr":[-8,0],"br":[0,0],"bl":[0,0]}',
    })]);
    expect(plain.draws).toHaveLength(1);
    // 12×12 cells × 2 triangles — the mesh, not a single blit
    expect(bent.draws.length).toBe(12 * 12 * 2);
  });

  it("renders a text layer without needing a pixel buffer", () => {
    const layer = makeLayer({
      id: "t", kind: "text", width: 200, height: 60,
      text: { content: "Hello", fontFamily: "Inter", fontSize: 40, color: "#fff", bold: true, italic: false },
    });
    expect(run([layer]).draws).toHaveLength(1);
  });

  it("renders an unpainted fill layer from its colour", () => {
    const layer = makeLayer({ id: "f", kind: "fill", fill: "#ff0000", width: 20, height: 20 });
    expect(run([layer]).draws).toHaveLength(1);
  });

  it("prefers a fill layer's pixels once it has been painted on", () => {
    const painted = pixels("f", 20, 20);
    const layer = makeLayer({ id: "f", kind: "fill", fill: "#ff0000", width: 20, height: 20 });
    expect(run([layer]).draws[0].source).toBe(painted);
  });

  it("paints the document background first when one is given", () => {
    const { out } = run([], { background: "#123456" });
    const fills = imageDraws(out);
    expect(fills).toHaveLength(0); // background is a fillRect, not an image
  });

  it("treats the fully-transparent background sentinel as no background", () => {
    expect(() => run([], { background: "#00000000" })).not.toThrow();
  });
});
