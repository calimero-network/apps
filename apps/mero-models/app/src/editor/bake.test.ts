import { unzlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { bake, BakeError } from "./bake";
import type { Poly } from "./poly";
import { joinPolys, transformPoly } from "./polyops";
import { encodePng } from "./png";
import { primitivePoly } from "./polymesh";
import { generate, smartMaterial } from "./texgen";
import { smartProject } from "./uv";

const plane = () => primitivePoly("plane", 1)!;
const scaled = (p: Poly, s: [number, number, number], t: [number, number, number] = [0, 0, 0]) =>
  transformPoly(p, [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, t[0], t[1], t[2], 1]);
const opts = { size: 32, aoSamples: 16, aoDistance: 0.5, edgeWidth: 0.05 };
const texel = (size: number, u: number, v: number) => Math.min(size - 1, Math.floor((1 - v) * size)) * size + Math.min(size - 1, Math.floor(u * size));

describe("baking", () => {
  it("covers a plane's UVs, sees open sky everywhere, and bakes a flat normal", async () => {
    const maps = await bake(plane(), opts);
    expect(maps.coverage.reduce((a, b) => a + b, 0)).toBeGreaterThan(32 * 32 * 0.9);
    expect(maps.overlap).toBe(0);
    expect(Math.min(...maps.ao)).toBeGreaterThan(0.99);
    const k = texel(32, 0.5, 0.5);
    expect([...maps.normal.slice(k * 3, k * 3 + 3)]).toEqual([0, 0, 1]);
  });

  it("refuses a mesh with no UVs", async () => {
    await expect(bake({ ...plane(), uvs: null }, opts)).rejects.toThrow(BakeError);
  });

  it("finds a cube's edges for wear and leaves its faces clean", async () => {
    const cube = smartProject(primitivePoly("cube", 1)!, null, 66, 0.02);
    const maps = await bake(cube, { ...opts, size: 64, aoSamples: 0, edgeWidth: 0.08 });
    let nearEdge = 0;
    let centre = 1;
    for (let k = 0; k < maps.size * maps.size; k += 1) {
      if (!maps.coverage[k]) continue;
      const p = [maps.position[k * 3]!, maps.position[k * 3 + 1]!, maps.position[k * 3 + 2]!].map(Math.abs).sort((a, b) => b - a);
      // On a face (one coordinate at 0.5): the next largest says how close to an edge.
      if (p[1]! > 0.48) nearEdge = Math.max(nearEdge, maps.edges[k]!);
      if (p[1]! < 0.2) centre = Math.min(centre, 1 - maps.edges[k]!);
    }
    expect(nearEdge).toBeGreaterThan(0.6);
    expect(centre).toBeGreaterThan(0.99);
    expect(Math.max(...maps.cavity)).toBe(0);
  });

  it("occludes the ground around a box standing on it", async () => {
    const ground = scaled(plane(), [4, 1, 4]);
    const box = scaled(primitivePoly("cube", 1)!, [1, 1, 1], [0, 0.5, 0]);
    const scene = smartProject(joinPolys([ground, box]), null, 66, 0.01);
    const maps = await bake(scene, { ...opts, size: 64, aoSamples: 32, aoDistance: 0.3 });
    let near = 1;
    let far = 0;
    for (let k = 0; k < 64 * 64; k += 1) {
      if (!maps.coverage[k] || Math.abs(maps.position[k * 3 + 1]!) > 1e-4) continue;
      const r = Math.max(Math.abs(maps.position[k * 3]!), Math.abs(maps.position[k * 3 + 2]!));
      if (r > 0.5 && r < 0.6) near = Math.min(near, maps.ao[k]!);
      if (r > 1.7) far = Math.max(far, maps.ao[k]!);
    }
    expect(near).toBeLessThan(0.75);
    expect(far).toBeGreaterThan(0.95);
  });

  it("bakes a high surface's tilt into the normal map, in the convention three.js reads", async () => {
    // The high surface rises towards +X, so its normal leans to −X — against U.
    const high: Poly = { ...plane(), positions: plane().positions.map((x, i, a) => (i % 3 === 1 ? a[i - 1]! * 0.2 : x)) };
    const maps = await bake(plane(), { ...opts, aoSamples: 0, high, cageDistance: 0.3 });
    const k = texel(32, 0.5, 0.5);
    const [nx, ny, nz] = maps.normal.slice(k * 3, k * 3 + 3);
    expect(nx).toBeCloseTo(-0.2 / Math.hypot(0.2, 1), 2);
    expect(ny).toBeCloseTo(0, 2);
    expect(nz).toBeGreaterThan(0.95);
  });
});

describe("smart materials", () => {
  it("wears paint off the edges of a painted metal cube", async () => {
    const cube = smartProject(primitivePoly("cube", 1)!, null, 66, 0.02);
    const maps = await bake(cube, { ...opts, size: 64, aoSamples: 0, edgeWidth: 0.08 });
    const tex = await generate(maps, smartMaterial("painted-metal"), "#d9822b");
    let edgeMetal = 0;
    let centreMetal = 1;
    for (let k = 0; k < 64 * 64; k += 1) {
      if (!maps.coverage[k]) continue;
      if (maps.edges[k]! > 0.85) edgeMetal = Math.max(edgeMetal, tex.orm[k * 4 + 2]! / 255);
      if (maps.edges[k]! === 0) centreMetal = Math.min(centreMetal, 1 - tex.orm[k * 4 + 2]! / 255);
    }
    expect(edgeMetal).toBeGreaterThan(0.8);
    expect(centreMetal).toBeGreaterThan(0.8);
  });

  it("is deterministic, so regenerating an unchanged mesh makes the same textures", async () => {
    const maps = await bake(plane(), opts);
    const a = await generate(maps, smartMaterial("concrete"), "#888888");
    const b = await generate(maps, smartMaterial("concrete"), "#888888");
    expect(encodePng(a.baseColor, 32, 32)).toEqual(encodePng(b.baseColor, 32, 32));
  });
});

describe("the PNG encoder", () => {
  it("writes a valid RGBA PNG whose pixels decompress back", () => {
    const rgba = new Uint8Array(4 * 3 * 4).map((_, i) => (i * 37) & 255);
    const png = encodePng(rgba, 4, 3);
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer);
    expect(view.getUint32(16)).toBe(4);
    expect(view.getUint32(20)).toBe(3);
    const idatLen = view.getUint32(33);
    const raw = unzlibSync(png.subarray(41, 41 + idatLen));
    expect(raw.length).toBe(3 * (4 * 4 + 1));
    expect([...raw.subarray(1, 17)]).toEqual([...rgba.subarray(0, 16)]);
  });
});
