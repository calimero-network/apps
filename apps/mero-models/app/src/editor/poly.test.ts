import { describe, expect, it } from "vitest";
import { decodeMesh, encodeMesh, meshCounts } from "./meshcodec";
import { catmullClark, evaluate } from "./modifiers";
import { edgeEnds, edgeKey, facesOfVerts, topology, vertexTotal, type Poly } from "./poly";
import {
  MeshOpError,
  bevelEdges,
  bisect,
  bridgeLoops,
  connectVerts,
  deleteFacesPoly,
  dissolveEdges,
  edgeLoop,
  edgeRing,
  extrudeFaces,
  fillLoops,
  insetFaces,
  joinPolys,
  loopCut,
  mergeAtCenter,
  symmetrize,
} from "./polyops";
import { primitivePoly, shapeFromPoly } from "./polymesh";

const cube = () => primitivePoly("cube", 1)!;
const cylinder = (n = 8) => primitivePoly("cylinder", n)!;

/** Every edge between exactly two faces, each running it once in each direction: a closed, consistently wound surface. */
function expectClosed(p: Poly) {
  const t = topology(p);
  for (const [key, faces] of t.edgeFaces) {
    expect(faces.length, `edge ${edgeEnds(key)} has ${faces.length} faces`).toBe(2);
    const [a, b] = edgeEnds(key);
    expect(t.directed.has(a * 67_108_864 + b) && t.directed.has(b * 67_108_864 + a)).toBe(true);
  }
}

const sizes = (p: Poly) => p.faces.map((f) => f.length).sort((a, b) => a - b);
const topFace = (p: Poly) => p.faces.findIndex((f) => f.every((v) => p.positions[v * 3 + 1]! > 0.49));

describe("a primitive's cage", () => {
  it("is a cube of six quads with twelve hard edges", () => {
    const p = cube();
    expect(vertexTotal(p)).toBe(8);
    expect(sizes(p)).toEqual([4, 4, 4, 4, 4, 4]);
    expect(p.sharp.size).toBe(12);
    expect(p.uvs).not.toBeNull();
    expectClosed(p);
  });

  it("gives a cylinder quad sides and one n-gon per cap", () => {
    const p = cylinder(8);
    expect(sizes(p)).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 8, 8]);
    expectClosed(p);
  });

  it("keeps a sphere's poles as triangles and the rest as quads", () => {
    const p = primitivePoly("sphere", 8)!;
    expect(p.faces.filter((f) => f.length === 3)).toHaveLength(16);
    expect(p.faces.filter((f) => f.length === 4)).toHaveLength(16);
    expectClosed(p);
  });
});

describe("drawing a cage", () => {
  it("splits vertices along hard edges, so a cube draws flat-sided", () => {
    const s = shapeFromPoly(cube());
    expect(s.positions.length / 3).toBe(24);
    expect(s.indices.length / 3).toBe(12);
  });

  it("shares vertices across soft edges, and draws steep ones hard even unmarked", () => {
    // A 16-sided tube: the sides meet at 22.5° and share; the caps meet them at 90°.
    const tube = { ...cylinder(16), sharp: new Set<number>(), uvs: null };
    expect(shapeFromPoly(tube).positions.length / 3).toBe(16 * 2 + 16 * 2);
    const box = { ...cube(), sharp: new Set<number>(), uvs: null };
    expect(shapeFromPoly(box).positions.length / 3).toBe(24);
  });

  it("triangulates an n-gon into n − 2 triangles", () => {
    const s = shapeFromPoly(cylinder(8));
    expect(s.indices.length / 3).toBe(8 * 2 + 6 * 2);
  });
});

describe("selecting by topology", () => {
  it("follows an edge loop around a cylinder's side", () => {
    const p = loopCut(cylinder(8), ...firstVerticalEdge(cylinder(8)), 1).poly;
    const mid = [...Array(vertexTotal(p)).keys()].filter((v) => Math.abs(p.positions[v * 3 + 1]!) < 1e-6);
    expect(mid).toHaveLength(8);
    const loop = edgeLoop(p, mid[0]!, p.faces.flatMap((f) => f).find((v) => mid.includes(v) && v !== mid[0] && topology(p).neighbours[mid[0]!]!.includes(v))!);
    expect(loop).toHaveLength(8);
  });

  it("follows an edge ring across quads", () => {
    const p = cylinder(8);
    const ring = edgeRing(p, ...firstVerticalEdge(p));
    expect(ring.edges).toHaveLength(8);
    expect(ring.faces.size).toBe(8);
  });
});

function firstVerticalEdge(p: Poly): [number, number] {
  for (const key of topology(p).edgeFaces.keys()) {
    const [a, b] = edgeEnds(key);
    if (Math.abs(p.positions[a * 3]! - p.positions[b * 3]!) < 1e-6 && Math.abs(p.positions[a * 3 + 2]! - p.positions[b * 3 + 2]!) < 1e-6) return [a, b];
  }
  throw new Error("no vertical edge");
}

describe("the modelling tools", () => {
  it("loop-cuts a cube into a ring of eight quads plus caps", () => {
    const p = cube();
    const [a, b] = firstVerticalEdge(p);
    const { poly, verts } = loopCut(p, a, b, 1);
    expect(vertexTotal(poly)).toBe(12);
    expect(poly.faces).toHaveLength(10);
    expect(verts!.size).toBe(4);
    expectClosed(poly);
    const two = loopCut(p, a, b, 3).poly;
    expect(vertexTotal(two)).toBe(8 + 12);
    expectClosed(two);
  });

  it("refuses a loop cut where there is no ring of quads", () => {
    const tri: Poly = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], faces: [[0, 1, 2]], uvs: null, sharp: new Set(), modifiers: [] };
    expect(() => loopCut(tri, 0, 1)).toThrow(MeshOpError);
  });

  it("bevels one cube edge into a chamfer, leaving it closed", () => {
    const p = cube();
    const [a, b] = firstVerticalEdge(p);
    const { poly, faces } = bevelEdges(p, new Set([edgeKey(a, b)]), 0.1);
    expect(vertexTotal(poly)).toBe(10);
    expect(poly.faces).toHaveLength(7);
    expect(faces!.size).toBe(1);
    expectClosed(poly);
  });

  it("bevels every edge of a cube, with a corner patch at each vertex", () => {
    const p = cube();
    const { poly } = bevelEdges(p, new Set(topology(p).edgeFaces.keys()), 0.1);
    expect(poly.faces).toHaveLength(6 + 12 + 8);
    expect(vertexTotal(poly)).toBe(24);
    expectClosed(poly);
  });

  it("insets a face as a smaller face and a ring of quads", () => {
    const p = cube();
    const top = topFace(p);
    const { poly, faces } = insetFaces(p, new Set([top]), 0.1, 0);
    expect(vertexTotal(poly)).toBe(12);
    expect(poly.faces).toHaveLength(10);
    const inner = poly.faces[[...faces!][0]!]!;
    for (const v of inner) expect(Math.abs(poly.positions[v * 3]!)).toBeCloseTo(0.4);
    expectClosed(poly);
  });

  it("extrudes a face along its normal with walls back to the body", () => {
    const p = cube();
    const top = topFace(p);
    const { poly, faces } = extrudeFaces(p, new Set([top]), 0.5);
    expect(poly.faces).toHaveLength(10);
    for (const v of poly.faces[[...faces!][0]!]!) expect(poly.positions[v * 3 + 1]).toBeCloseTo(1);
    expectClosed(poly);
  });

  it("extrudes a region of two faces as one, with no wall between them", () => {
    const p = cube();
    const top = topFace(p);
    const side = p.faces.findIndex((f) => f.every((v) => p.positions[v * 3]! > 0.49));
    const { poly } = extrudeFaces(p, new Set([top, side]), 0.2);
    expect(poly.faces).toHaveLength(6 + 6);
    expectClosed(poly);
  });

  it("bridges two open loops and fills a hole", () => {
    const p = cylinder(8);
    const caps = new Set(p.faces.map((f, i) => (f.length === 8 ? i : -1)).filter((i) => i >= 0));
    const tube = deleteFacesPoly(p, caps);
    const lifted = { ...tube, positions: tube.positions.map((x, i) => (i % 3 === 1 ? x + 2 : x)) };
    const two = joinPolys([tube, lifted]);
    // The first tube's top and the second's bottom.
    const facing = new Set([...Array(vertexTotal(two)).keys()].filter((v) => Math.abs(two.positions[v * 3 + 1]! - 1) < 0.6));
    const bridged = bridgeLoops(two, facing);
    expect(bridged.faces!.size).toBe(8);
    const t = topology(bridged.poly);
    const open = [...t.edgeFaces.values()].filter((f) => f.length === 1).length;
    expect(open).toBe(16); // only the far ends are still open
    expect([...t.edgeFaces.values()].every((f) => f.length <= 2)).toBe(true);
    const filled = fillLoops(tube, new Set([...Array(vertexTotal(tube)).keys()]));
    expect(filled.faces!.size).toBe(2);
    expectClosed(filled.poly);
  });

  it("connects two vertices across a face", () => {
    const p = cube();
    const top = p.faces[topFace(p)]!;
    const { poly } = connectVerts(p, new Set([top[0]!, top[2]!]));
    expect(poly.faces).toHaveLength(7);
    expectClosed(poly);
  });

  it("knifes a plane through a cube", () => {
    const { poly, verts } = bisect(cube(), 0, 0);
    expect(vertexTotal(poly)).toBe(12);
    expect(poly.faces).toHaveLength(10);
    expect(verts!.size).toBe(4);
    expectClosed(poly);
  });

  it("dissolving a loop cut gives the cube back", () => {
    const p = cube();
    const [a, b] = firstVerticalEdge(p);
    const cut = loopCut(p, a, b, 1);
    const edges = new Set<number>();
    for (const key of topology(cut.poly).edgeFaces.keys()) {
      const [x, y] = edgeEnds(key);
      if (cut.verts!.has(x) && cut.verts!.has(y)) edges.add(key);
    }
    const back = dissolveEdges(cut.poly, edges).poly;
    expect(vertexTotal(back)).toBe(8);
    expect(back.faces).toHaveLength(6);
    expectClosed(back);
  });

  it("merges vertices at their centre", () => {
    const p = cube();
    const top = p.faces[topFace(p)]!;
    const { poly, verts } = mergeAtCenter(p, new Set(top));
    expect(vertexTotal(poly)).toBe(5);
    expect(verts!.size).toBe(1);
    expectClosed(poly);
  });

  it("symmetrizes, welding the halves", () => {
    const p = cube();
    const shifted = { ...p, positions: p.positions.map((x, i) => (i % 3 === 0 ? x + 0.25 : x)) };
    const sym = symmetrize(shifted, 0, true);
    const xs = [...Array(vertexTotal(sym)).keys()].map((v) => sym.positions[v * 3]!);
    expect(Math.max(...xs)).toBeCloseTo(0.75);
    expect(Math.min(...xs)).toBeCloseTo(-0.75);
    expectClosed(sym);
  });
});

describe("modifiers", () => {
  it("subdivides with hard edges as creases", () => {
    const p = cube();
    const s = catmullClark(p);
    expect(vertexTotal(s)).toBe(8 + 12 + 6);
    expect(s.faces).toHaveLength(24);
    // Every cube edge is hard, so the corners stay put.
    const corner = s.positions.slice(0, 3).map(Math.abs);
    expect(corner).toEqual([0.5, 0.5, 0.5]);
    const soft = catmullClark({ ...p, sharp: new Set() });
    expect(Math.abs(soft.positions[0]!)).toBeLessThan(0.5);
    expectClosed(s);
  });

  it("evaluates the stack in order", () => {
    const p = { ...cube(), modifiers: [{ type: "mirror" as const, axis: 0 as const, weld: 0.001, on: true }, { type: "array" as const, count: 2, offset: [0, 2, 0] as [number, number, number], on: true }] };
    const shifted = { ...p, positions: p.positions.map((x, i) => (i % 3 === 0 ? x + 1 : x)) };
    const { poly } = evaluate(shifted);
    expect(poly.faces).toHaveLength(6 * 2 * 2);
    const off = { ...shifted, modifiers: shifted.modifiers.map((m) => ({ ...m, on: false })) };
    expect(evaluate(off).poly.faces).toHaveLength(6);
  });
});

describe("the cage blob format", () => {
  it("round-trips a cage with UVs, hard edges and modifiers", () => {
    const p = { ...cylinder(6), modifiers: [{ type: "subdivision" as const, levels: 1, on: true }] };
    const shape = shapeFromPoly(p);
    const bytes = encodeMesh(shape);
    expect(bytes[4]).toBe(2);
    const back = decodeMesh(bytes, meshCounts(shape));
    expect(back.poly!.faces).toEqual(p.faces);
    expect([...back.poly!.sharp].sort()).toEqual([...p.sharp].sort());
    expect(back.poly!.modifiers).toEqual(p.modifiers);
    expect(back.poly!.uvs!.flat()).toEqual(p.uvs!.flat().map(Math.fround));
    expect(back.indices.length).toBe(shape.indices.length);
    expect(encodeMesh(back)).toEqual(bytes);
  });

  it("counts a cage by its vertices and the triangles its faces make", () => {
    expect(meshCounts(shapeFromPoly(cylinder(8)))).toEqual({ vertex_count: 16, triangle_count: 28 });
  });

  it("refuses a cage that disagrees with its reference or has a modifier out of range", () => {
    const shape = shapeFromPoly(cube());
    expect(() => decodeMesh(encodeMesh(shape), { vertex_count: 8, triangle_count: 11 })).toThrow(/reference says/);
    const bad = shapeFromPoly({ ...cube(), modifiers: [{ type: "subdivision", levels: 9, on: true }] as never });
    expect(() => decodeMesh(encodeMesh(bad))).toThrow(/modifier/);
  });

  it("still writes a triangle mesh without a cage as format 1", () => {
    const { poly: _poly, ...tris } = shapeFromPoly(cube());
    expect(encodeMesh(tris)[4]).toBe(1);
  });
});

describe("selection helpers", () => {
  it("finds the faces whose every corner is selected", () => {
    const p = cube();
    const top = p.faces[topFace(p)]!;
    expect(facesOfVerts(p, new Set(top)).size).toBe(1);
  });
});
