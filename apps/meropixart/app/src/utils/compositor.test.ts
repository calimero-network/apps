import { describe, it, expect, beforeEach } from "vitest";
import { composite, invalidatePrepared, preparedCacheSize } from "./compositor";
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

beforeEach(() => {
  sources.clear();
  // The prepared-layer cache is module-level and keyed by layer id, so tests
  // that reuse an id must start from a clean slate.
  invalidatePrepared();
});

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

  it("bakes non-destructive adjustments as a CSS filter when preparing a layer", () => {
    // The filter is applied once, into the layer's prepared canvas — not on every
    // composite. So it shows up on the draw INTO that canvas…
    const src = pixels("a");
    const { draws } = run([makeLayer({
      id: "a",
      adjustments: { brightness: 50, contrast: 0, saturation: 0, hue: 90, exposure: 0, blur: 3, invert: true },
    })]);
    const prepared = draws[0].source!;
    const bake = imageDraws(prepared).find((d) => d.source === src);
    expect(bake?.filter).toContain("hue-rotate(90deg)");
    expect(bake?.filter).toContain("blur(3px)");
    expect(bake?.filter).toContain("invert(1)");
    // …and NOT on the composite draw, which is now a plain blit.
    expect(draws[0].filter).toBe("none");
  });

  it("pads a blurred layer so the blur is not clipped at its edges", () => {
    pixels("a", 40, 40);
    const { draws } = run([makeLayer({
      id: "a", width: 40, height: 40,
      adjustments: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 4, invert: false },
    })]);
    const prepared = draws[0].source!;
    expect(prepared.width).toBeGreaterThan(40);
    // and it is drawn back at the negative offset that padding introduced
    expect(draws[0].args[0]).toBeLessThan(0);
  });

  it("applies the layer's own transform matrix, mirror included", () => {
    pixels("a", 40, 20);
    const { draws } = run([makeLayer({ id: "a", x: 10, y: 5, width: 40, height: 20, flipH: true })]);
    // flipH mirrors about the centre: a = −1, and the origin shifts to the right edge
    expect(draws[0].transform[0]).toBeCloseTo(-1, 6);
    expect(draws[0].transform[4]).toBeCloseTo(50, 6);
    expect(draws[0].transform[5]).toBeCloseTo(5, 6);
  });

  it("draws a warp as a triangle mesh in the composite, not baked", () => {
    // Baking a warp is faster for a small layer and much SLOWER for a large one
    // (measured: Aurora's 900×520 card, 15.0ms baked vs 6.4ms live), so the mesh
    // stays in the composite loop — 12×12 cells × 2 triangles.
    pixels("bent", 40, 40);
    const { draws } = run([makeLayer({
      id: "bent", width: 40, height: 40,
      warp: '{"tl":[8,0],"tr":[-8,0],"br":[0,0],"bl":[0,0]}',
    })]);
    expect(draws.length).toBe(12 * 12 * 2);
  });

  it("DOES bake the warp when the layer is also blurred", () => {
    // A blur pads the prepared canvas, and a padded canvas cannot be fed to the
    // mesh (whose source rect must be the layer box), so this combination bakes.
    pixels("both", 40, 40);
    const { draws } = run([makeLayer({
      id: "both", width: 40, height: 40,
      warp: '{"tl":[8,0],"tr":[-8,0],"br":[0,0],"bl":[0,0]}',
      adjustments: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 3, invert: false },
    })]);
    expect(draws).toHaveLength(1);
    expect(imageDraws(draws[0].source!).length).toBe(12 * 12 * 2);
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

  it("keeps a prepared entry per drawn layer", () => {
    pixels("a"); pixels("b");
    run([makeLayer({ id: "a" }), makeLayer({ id: "b" })]);
    expect(preparedCacheSize()).toBe(2);
  });
});

// ── The prepared-layer cache ────────────────────────────────────────────────
//
// This is the thing that took a drag in Sunset Ridge from ~49ms a frame to ~7ms,
// so its invalidation rules are worth pinning: too eager and the performance win
// evaporates, too lazy and the canvas shows stale pixels.
describe("prepared-layer caching", () => {
  beforeEach(() => {
    sources.clear();
    invalidatePrepared();
  });

  /** How many times the expensive bake ran for a layer, across composites. */
  function bakesOf(layer: Layer, times: number, mutate?: (n: number) => void): number {
    const canvases: HTMLCanvasElement[] = [];
    for (let i = 0; i < times; i++) {
      mutate?.(i);
      const { draws } = run([layer]);
      if (draws[0]) canvases.push(draws[0].source!);
    }
    return new Set(canvases).size;
  }

  it("does not re-prepare a layer that only moved", () => {
    const src = pixels("a", 40, 40);
    void src;
    const layer = makeLayer({
      id: "a", width: 40, height: 40,
      adjustments: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 4, invert: false },
    });
    // A drag changes x/y (and nothing else about the pixels) every frame.
    const distinct = bakesOf(layer, 5, (n) => { layer.x = n * 7; layer.y = n * 3; });
    expect(distinct).toBe(1);
  });

  it("does not re-prepare for a rotation, scale, shear or mirror either", () => {
    pixels("a", 40, 40);
    const layer = makeLayer({
      id: "a", width: 40, height: 40,
      adjustments: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 4, invert: false },
    });
    const distinct = bakesOf(layer, 4, (n) => {
      layer.rotation = n * 10;
      layer.scaleX = 100 + n;
      layer.skewX = n;
      layer.flipH = n % 2 === 0;
    });
    expect(distinct).toBe(1);
  });

  it("does not re-prepare for opacity or blend mode", () => {
    pixels("a", 40, 40);
    const layer = makeLayer({
      id: "a", width: 40, height: 40,
      adjustments: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 4, invert: false },
    });
    const modes: Layer["blendMode"][] = ["normal", "multiply", "screen", "overlay"];
    const distinct = bakesOf(layer, 4, (n) => {
      layer.opacity = 100 - n * 10;
      layer.blendMode = modes[n];
    });
    expect(distinct).toBe(1);
  });

  it("DOES re-prepare when an adjustment changes", () => {
    pixels("a", 40, 40);
    const layer = makeLayer({ id: "a", width: 40, height: 40 });
    const distinct = bakesOf(layer, 3, (n) => {
      layer.adjustments = { ...layer.adjustments, blur: n * 2 };
    });
    expect(distinct).toBe(3);
  });

  it("does not re-prepare when only the warp changes — it is not baked", () => {
    // Dragging a warp pin changes `warp` every frame; since the mesh is applied
    // in the composite loop, the prepared pixels are untouched.
    pixels("a", 40, 40);
    const layer = makeLayer({
      id: "a", width: 40, height: 40,
      adjustments: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 0, invert: false },
    });
    let prepared: HTMLCanvasElement | undefined;
    let distinct = 0;
    for (let n = 0; n < 3; n++) {
      layer.warp = n === 0 ? "" : `{"tl":[${n * 4},0],"tr":[0,0],"br":[0,0],"bl":[0,0]}`;
      const source = run([layer]).draws[0]?.source;
      if (source !== prepared) { distinct += 1; prepared = source; }
    }
    expect(distinct).toBe(1);
  });

  it("DOES re-prepare when the source canvas is a different buffer", () => {
    // The registry's version counter cannot see this: a caller supplying its own
    // `sources` (the showcase previews, this suite) swaps the canvas object.
    const layer = makeLayer({
      id: "a", width: 40, height: 40,
      adjustments: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 4, invert: false },
    });
    const distinct = bakesOf(layer, 3, () => { pixels("a", 40, 40); });
    expect(distinct).toBe(3);
  });

  it("DOES re-prepare when a text layer's typography changes", () => {
    const layer = makeLayer({
      id: "t", kind: "text", width: 200, height: 60,
      text: { content: "Hello", fontFamily: "Inter", fontSize: 40, color: "#fff", bold: true, italic: false },
      adjustments: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 3, invert: false },
    });
    const distinct = bakesOf(layer, 3, (n) => {
      layer.text = { ...layer.text!, content: `Hello ${n}` };
    });
    expect(distinct).toBe(3);
  });

  it("DOES re-prepare when a fill layer's colour changes", () => {
    const layer = makeLayer({
      id: "f", kind: "fill", fill: "#ff0000", width: 20, height: 20,
      adjustments: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 2, invert: false },
    });
    const distinct = bakesOf(layer, 3, (n) => { layer.fill = ["#ff0000", "#00ff00", "#0000ff"][n]; });
    expect(distinct).toBe(3);
  });

  it("prunes a deleted layer's prepared canvas — they are large", () => {
    pixels("a"); pixels("b");
    run([makeLayer({ id: "a" }), makeLayer({ id: "b" })]);
    expect(preparedCacheSize()).toBe(2);
    run([makeLayer({ id: "a" })]); // "b" was deleted
    expect(preparedCacheSize()).toBe(1);
  });

  it("invalidatePrepared() drops one layer, or all of them", () => {
    pixels("a"); pixels("b");
    run([makeLayer({ id: "a" }), makeLayer({ id: "b" })]);
    expect(preparedCacheSize()).toBe(2);
    invalidatePrepared("a");
    expect(preparedCacheSize()).toBe(1);
    invalidatePrepared();
    expect(preparedCacheSize()).toBe(0);
  });
});
