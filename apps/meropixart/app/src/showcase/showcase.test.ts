// Guards the four documents the "Open Showcase Project…" gallery ships.
//
// A showcase that loads over someone's work and then renders wrong is worse than
// no showcase at all, so every property the loader and the e2e specs depend on is
// asserted here: the folder references resolve, the ids are unique, the recipes
// render, and the transforms the notes advertise are actually present.

import { describe, it, expect } from "vitest";
import { SHOWCASE_PROJECTS, findShowcase } from "./index";
import { buildShowcase, resolveWarp, stableIds } from "./build";
import { renderShowcase, renderShowcaseThumb } from "./preview";
import { paintCanvas } from "./paint";
import { parseWarp } from "../utils/transform";
import { presetCorners } from "../utils/warpPresets";
import { drawCalls } from "../test/canvasStub";
import type { PaintOp, ShowcaseProject } from "./types";

const ids = SHOWCASE_PROJECTS.map((p) => p.id);

describe("the showcase catalogue", () => {
  it("ships four distinct projects", () => {
    expect(SHOWCASE_PROJECTS.length).toBe(4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is reachable by id, and unknown ids answer undefined", () => {
    for (const id of ids) expect(findShowcase(id)?.id).toBe(id);
    expect(findShowcase("nope")).toBeUndefined();
  });

  it("gives every project the metadata the picker card renders", () => {
    for (const p of SHOWCASE_PROJECTS) {
      expect(p.name.length, p.id).toBeGreaterThan(2);
      expect(p.tagline.length, p.id).toBeGreaterThan(10);
      expect(p.notes.length, p.id).toBeGreaterThanOrEqual(3);
      expect(p.background, p.id).toMatch(/^#[0-9a-fA-F]{6,8}$/);
    }
  });

  it("keeps every canvas inside the size the New Project modal allows", () => {
    for (const p of SHOWCASE_PROJECTS) {
      expect(p.width, p.id).toBeGreaterThan(0);
      expect(p.width, p.id).toBeLessThanOrEqual(8192);
      expect(p.height, p.id).toBeLessThanOrEqual(8192);
    }
  });

  it("is worth calling a showcase — real layer counts and real folders", () => {
    for (const p of SHOWCASE_PROJECTS) {
      expect(p.layers.length, p.id).toBeGreaterThanOrEqual(12);
      const folders = p.layers.filter((l) => l.kind === "group");
      expect(folders.length, p.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("loads in a sane amount of work — one add_layer per layer plus blobs", () => {
    // The loader is sequential on purpose; keep the documents from growing into a
    // minute-long load without anyone noticing.
    for (const p of SHOWCASE_PROJECTS) {
      expect(p.layers.length, p.id).toBeLessThanOrEqual(40);
    }
  });
});

describe.each(SHOWCASE_PROJECTS.map((p) => [p.id, p] as const))("%s", (_id, project: ShowcaseProject) => {
  const built = buildShowcase(project, { idFor: stableIds(project) });

  it("resolves every folder reference", () => {
    expect(built.warnings).toEqual([]);
  });

  it("declares each folder before the layers that name it", () => {
    // The loader relies on array order to map folder names to freshly minted ids.
    const seen = new Set<string>();
    for (const layer of project.layers) {
      if (layer.group) expect(seen.has(layer.group), `${layer.name} → ${layer.group}`).toBe(true);
      if (layer.kind === "group") seen.add(layer.name);
    }
  });

  it("gives folders unique names, since layers reference them by name", () => {
    const names = project.layers.filter((l) => l.kind === "group").map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("produces unique layer ids and unique paint order", () => {
    const layerIds = built.layers.map((l) => l.id);
    expect(new Set(layerIds).size).toBe(layerIds.length);
    const indices = built.layers.map((l) => l.layerIndex);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("claims no author — the contract stores createdBy verbatim", () => {
    expect(built.layers.every((l) => l.createdBy === "")).toBe(true);
  });

  it("only uses layer kinds the compositor can draw", () => {
    for (const l of built.layers) {
      expect(["raster", "text", "fill", "group"]).toContain(l.kind);
    }
  });

  it("gives every raster layer either pixels or a reason not to have them", () => {
    for (const l of built.layers) {
      if (l.kind !== "raster") continue;
      expect(built.canvases.has(l.id), `${l.name} has no paint recipe`).toBe(true);
    }
  });

  it("sizes every pixel canvas to its layer", () => {
    for (const [id, canvas] of built.canvases) {
      const layer = built.layers.find((l) => l.id === id)!;
      expect([canvas.width, canvas.height], layer.name).toEqual([layer.width, layer.height]);
    }
  });

  it("flags a mask blob for every layer with a mask recipe, so it composites", () => {
    for (const l of built.layers) {
      const hasMask = built.masks.has(l.id);
      expect(Boolean(l.maskBlobId), l.name).toBe(hasMask);
    }
  });

  it("keeps every transform inside the contract's ranges", () => {
    for (const l of built.layers) {
      expect(l.opacity, l.name).toBeGreaterThanOrEqual(0);
      expect(l.opacity, l.name).toBeLessThanOrEqual(100);
      expect(Math.abs(l.rotation), l.name).toBeLessThanOrEqual(360);
      expect(Math.abs(l.skewX), l.name).toBeLessThanOrEqual(80);
      expect(Math.abs(l.skewY), l.name).toBeLessThanOrEqual(80);
      expect(Number.isInteger(l.x) && Number.isInteger(l.y), l.name).toBe(true);
      expect(Number.isInteger(l.width) && Number.isInteger(l.height), l.name).toBe(true);
    }
  });

  it("stores every warp as parseable JSON", () => {
    for (const l of built.layers) {
      if (!l.warp) continue;
      expect(parseWarp(l.warp), l.name).not.toBeNull();
    }
  });

  it("renders through the real compositor without throwing", () => {
    const canvas = renderShowcase(project);
    expect([canvas.width, canvas.height]).toEqual([project.width, project.height]);
    expect(drawCalls(canvas).length).toBeGreaterThan(0);
  });

  it("renders a thumbnail that keeps the aspect ratio", () => {
    const thumb = renderShowcaseThumb(project, 520, 520);
    expect(thumb.width).toBeLessThanOrEqual(520);
    expect(thumb.height).toBeLessThanOrEqual(520);
    const wanted = project.width / project.height;
    expect(thumb.width / thumb.height).toBeCloseTo(wanted, 1);
  });

  it("is deterministic — the same recipe builds the same layers twice", () => {
    const again = buildShowcase(project, { idFor: stableIds(project) });
    expect(again.layers).toEqual(built.layers);
  });
});

describe("buildShowcase", () => {
  const project = SHOWCASE_PROJECTS[0];

  it("mints fresh ids by default, since they become contract keys", () => {
    const a = buildShowcase(project);
    const b = buildShowcase(project);
    expect(a.layers[0].id).not.toBe(b.layers[0].id);
  });

  it("threads the author and timestamp onto every layer", () => {
    const built = buildShowcase(project, { author: "me", now: 1234 });
    expect(built.layers.every((l) => l.createdBy === "me" && l.createdAt === 1234)).toBe(true);
  });

  it("warns instead of throwing when a recipe names a missing folder", () => {
    const broken: ShowcaseProject = {
      ...project,
      id: "broken",
      layers: [{ name: "Orphan", kind: "raster", group: "Nowhere", x: 0, y: 0, width: 4, height: 4, paint: [] }],
    };
    const built = buildShowcase(broken);
    expect(built.warnings).toHaveLength(1);
    expect(built.warnings[0]).toContain("Nowhere");
    expect(built.layers[0].parentId).toBeNull(); // still loadable, at the top level
  });

  it("nests a folder inside another folder", () => {
    const nested: ShowcaseProject = {
      ...project,
      id: "nested",
      layers: [
        { name: "Outer", kind: "group", x: 0, y: 0, width: 10, height: 10 },
        { name: "Inner", kind: "group", group: "Outer", x: 0, y: 0, width: 10, height: 10 },
        { name: "Leaf", kind: "raster", group: "Inner", x: 0, y: 0, width: 4, height: 4, paint: [] },
      ],
    };
    const built = buildShowcase(nested, { idFor: stableIds(nested) });
    expect(built.layers[1].parentId).toBe(built.layers[0].id);
    expect(built.layers[2].parentId).toBe(built.layers[1].id);
  });

  it("clamps a zero-size layer to one pixel", () => {
    const tiny: ShowcaseProject = {
      ...project, id: "tiny",
      layers: [{ name: "Dot", kind: "raster", x: 0, y: 0, width: 0, height: 0 }],
    };
    expect(buildShowcase(tiny).layers[0].width).toBe(1);
  });
});

describe("resolveWarp", () => {
  it("expands a preset name to the preset's own corners", () => {
    const size = { width: 200, height: 100 };
    expect(resolveWarp("perspective", size))
      .toBe(JSON.stringify(roundCorners(presetCorners("perspective", size))));
  });

  it("passes explicit corners through", () => {
    const encoded = resolveWarp({ tl: [3, 4], tr: [0, 0], br: [0, 0], bl: [0, 0] }, { width: 10, height: 10 });
    expect(parseWarp(encoded)!.tl).toEqual([3, 4]);
  });

  it("answers the empty string for no warp", () => {
    expect(resolveWarp(undefined, { width: 10, height: 10 })).toBe("");
  });
});

function roundCorners(w: ReturnType<typeof presetCorners>) {
  return {
    tl: w.tl.map(Math.round), tr: w.tr.map(Math.round),
    br: w.br.map(Math.round), bl: w.bl.map(Math.round),
  };
}

describe("the showcases exercise what they claim to", () => {
  const all = SHOWCASE_PROJECTS.flatMap((p) => buildShowcase(p, { idFor: stableIds(p) }).layers);

  it("uses rotation, both shears, both mirrors and a warp somewhere", () => {
    expect(all.some((l) => l.rotation !== 0)).toBe(true);
    expect(all.some((l) => l.skewX !== 0)).toBe(true);
    expect(all.some((l) => l.skewY !== 0)).toBe(true);
    expect(all.some((l) => l.flipH)).toBe(true);
    expect(all.some((l) => l.flipV)).toBe(true);
    expect(all.some((l) => l.warp)).toBe(true);
  });

  it("uses every warp preset across the catalogue", () => {
    const encoded = new Set(all.filter((l) => l.warp).map((l) => l.warp));
    expect(encoded.size).toBeGreaterThanOrEqual(4);
  });

  it("uses non-normal blend modes, masks, adjustments and a live text layer", () => {
    expect(all.some((l) => l.blendMode !== "normal")).toBe(true);
    expect(all.some((l) => l.maskBlobId)).toBe(true);
    expect(all.some((l) => l.adjustments.blur > 0)).toBe(true);
    expect(all.some((l) => l.kind === "text" && l.text?.content)).toBe(true);
    expect(all.some((l) => l.kind === "fill" && l.fill)).toBe(true);
  });

  it("locks the backdrop layers, so a stray brush stroke cannot ruin one", () => {
    expect(all.some((l) => l.locked)).toBe(true);
  });

  it("nests folders at least two deep somewhere", () => {
    const byId = new Map(all.map((l) => [l.id, l]));
    const depth = (l: (typeof all)[number]): number => {
      let d = 0;
      let cur = l;
      while (cur.parentId && d < 10) {
        const parent = byId.get(cur.parentId);
        if (!parent) break;
        cur = parent;
        d += 1;
      }
      return d;
    };
    expect(Math.max(...all.map(depth))).toBeGreaterThanOrEqual(2);
  });
});

describe("paintCanvas", () => {
  it("runs every op kind without throwing", () => {
    const ops: PaintOp[] = [
      { op: "fill", color: "#123456" },
      { op: "linear", from: [0, 0], to: [10, 10], stops: [[0, "#000"], [1, "#fff"]] },
      { op: "radial", at: [5, 5], r0: 0, r1: 5, stops: [[0, "#000"], [1, "#fff"]] },
      { op: "rect", x: 1, y: 1, w: 5, h: 5, color: "#f00", radius: 2, shadow: { blur: 3, color: "#000" } },
      { op: "rect", x: 1, y: 1, w: 5, h: 5, color: "#f00", stroke: true, width: 2 },
      { op: "ellipse", cx: 5, cy: 5, rx: 3, ry: 2, color: "#0f0", rotate: 30 },
      { op: "polygon", points: [0, 0, 5, 0, 5, 5], color: "#00f", alpha: 0.5 },
      { op: "polygon", points: [0, 0], color: "#00f" }, // too few points — must be ignored
      { op: "path", d: "M 0 0 L 10 10", color: "#fff", stroke: true, width: 1 },
      { op: "path", d: "M 0 0 L 10 0 L 10 10 Z", color: "#fff",
        gradient: { from: [0, 0], to: [10, 0], stops: [[0, "#000"], [1, "#fff"]] } },
      { op: "line", from: [0, 0], to: [10, 10], color: "#fff", dash: [2, 2] },
      { op: "text", text: "a\nb", x: 0, y: 0, size: 8, color: "#fff", tracking: 2 },
      { op: "text", text: "centred", x: 5, y: 0, size: 8, color: "#fff", align: "center", tracking: 1 },
      { op: "grid", step: 4, color: "#fff" },
      { op: "dots", step: 4, r: 1, color: "#fff" },
      { op: "stripes", angle: 45, width: 1, gap: 3, color: "#fff" },
      { op: "rings", cx: 5, cy: 5, from: 1, to: 4, step: 1, color: "#fff" },
      { op: "noise", amount: 0.5, seed: 3 },
      { op: "blur", radius: 2 },
      { op: "clip", mode: "in", ops: [{ op: "fill", color: "#fff" }] },
      { op: "clip", mode: "out", ops: [{ op: "rect", x: 0, y: 0, w: 2, h: 2, color: "#000" }] },
    ];
    const canvas = paintCanvas(ops, 12, 12);
    expect([canvas.width, canvas.height]).toEqual([12, 12]);
    expect(drawCalls(canvas).length).toBeGreaterThan(0);
  });

  it("masks with destination-in / destination-out, not source-in", () => {
    // source-in repaints the artwork with the stencil's colour instead of masking
    // it — the bug that turned a dark product card into a white slab.
    const canvas = paintCanvas([
      { op: "fill", color: "#123456" },
      { op: "clip", mode: "in", ops: [{ op: "rect", x: 0, y: 0, w: 4, h: 4, color: "#fff" }] },
    ], 8, 8);
    const stencil = drawCalls(canvas).filter((c) => c.kind === "drawImage");
    expect(stencil[stencil.length - 1]?.globalCompositeOperation).toBe("destination-in");
  });

  it("generates the same grain for the same seed", () => {
    const noise = (seed: number) => {
      const c = paintCanvas([{ op: "noise", amount: 1, seed }], 8, 8);
      const ctx = c.getContext("2d")!;
      return [...ctx.getImageData(0, 0, 8, 8).data];
    };
    expect(noise(5)).toEqual(noise(5));
    expect(noise(5)).not.toEqual(noise(6));
  });

  it("accepts an empty recipe", () => {
    expect(paintCanvas([], 4, 4).width).toBe(4);
  });
});
