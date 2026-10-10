import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  decimateToFit,
  deleteVertices,
  extrudeRegion,
  fitsLimits,
  flipNormals,
  joinShapes,
  mergeByDistance,
  primitiveGeometry,
  shapeCenter,
  shapeFromGeometry,
  smooth,
  subdivide,
  transformShape,
  triangleCount,
  vertexCount,
  type MeshShape,
} from "./geometry";
import { MAX_VERTICES } from "./model";

const cube = () => shapeFromGeometry(primitiveGeometry("cube", 32)!);

/** Every edge shared by exactly two triangles, in opposite directions: a closed, consistently wound surface. */
function isClosed(shape: MeshShape): boolean {
  const edges = new Map<string, number>();
  for (let t = 0; t < shape.indices.length; t += 3) {
    for (let k = 0; k < 3; k += 1) {
      const a = shape.indices[t + k]!;
      const b = shape.indices[t + ((k + 1) % 3)]!;
      edges.set(`${a}_${b}`, (edges.get(`${a}_${b}`) ?? 0) + 1);
    }
  }
  for (const [key, n] of edges) {
    const [a, b] = key.split("_");
    if (n !== 1 || edges.get(`${b}_${a}`) !== 1) return false;
  }
  return true;
}

function volume(shape: MeshShape): number {
  let v = 0;
  const p = (i: number) => new THREE.Vector3(shape.positions[i * 3], shape.positions[i * 3 + 1], shape.positions[i * 3 + 2]);
  for (let t = 0; t < shape.indices.length; t += 3) {
    v += p(shape.indices[t]!).dot(p(shape.indices[t + 1]!).cross(p(shape.indices[t + 2]!))) / 6;
  }
  return v;
}

describe("primitives become welded meshes", () => {
  it("a cube is 8 vertices and 12 triangles, closed, with unit volume", () => {
    const s = cube();
    expect(vertexCount(s)).toBe(8);
    expect(triangleCount(s)).toBe(12);
    expect(isClosed(s)).toBe(true);
    expect(volume(s)).toBeCloseTo(1, 5);
  });

  it("a sphere's seam is welded, so it stays closed", () => {
    const s = shapeFromGeometry(primitiveGeometry("sphere", 16)!);
    expect(isClosed(s)).toBe(true);
    expect(volume(s)).toBeGreaterThan(0.45);
  });

  it("every curved primitive at the top segment count still fits one mesh", () => {
    for (const kind of ["sphere", "icosphere", "cylinder", "cone", "torus", "capsule"]) {
      expect(fitsLimits(shapeFromGeometry(primitiveGeometry(kind, 128)!)), kind).toBe(true);
    }
  });

  it("groups, lights and meshes have no primitive", () => {
    for (const kind of ["group", "mesh", "point_light"]) expect(primitiveGeometry(kind, 32)).toBeNull();
  });
});

describe("mesh operations", () => {
  it("subdivide quadruples the triangles and keeps the surface closed", () => {
    const s = subdivide(cube());
    expect(triangleCount(s)).toBe(48);
    expect(vertexCount(s)).toBe(8 + 18); // one new vertex per edge
    expect(isClosed(s)).toBe(true);
    expect(volume(s)).toBeCloseTo(1, 5);
  });

  it("smooth shrinks a cube toward a ball without opening it", () => {
    const s = smooth(subdivide(cube()), 0.5, 3);
    expect(isClosed(s)).toBe(true);
    expect(volume(s)).toBeLessThan(1);
    expect(volume(s)).toBeGreaterThan(0.2);
  });

  it("flip turns the surface inside out", () => {
    expect(volume(flipNormals(cube()))).toBeCloseTo(-1, 5);
  });

  it("a mirroring transform keeps the winding outward", () => {
    const mirrored = transformShape(cube(), new THREE.Matrix4().makeScale(-1, 1, 1));
    expect(volume(mirrored)).toBeCloseTo(1, 5);
  });

  it("merge by distance welds a duplicated cube back into one", () => {
    const doubled = joinShapes([cube(), cube()]);
    expect(vertexCount(doubled)).toBe(16);
    const merged = mergeByDistance(doubled, 1e-4);
    expect(vertexCount(merged)).toBe(8);
  });

  it("deleting a vertex removes the triangles around it and nothing else", () => {
    const s = deleteVertices(cube(), new Set([0]));
    expect(vertexCount(s)).toBe(7);
    // A cube corner touches 3 faces; with two triangles per face, 3–6 of them go.
    expect(triangleCount(s)).toBeLessThan(12);
    expect(triangleCount(s)).toBeGreaterThanOrEqual(6);
  });

  it("extruding the top face makes the box taller and keeps it closed", () => {
    const s = cube();
    const top = new Set<number>();
    for (let i = 0; i < vertexCount(s); i += 1) if (s.positions[i * 3 + 1]! > 0.4) top.add(i);
    expect(top.size).toBe(4);
    const result = extrudeRegion(s, top, 0.5)!;
    expect(result).not.toBeNull();
    expect(result.selection.size).toBe(4);
    expect(isClosed(result.shape)).toBe(true);
    expect(volume(result.shape)).toBeCloseTo(1.5, 5);
    for (const i of result.selection) expect(result.shape.positions[i * 3 + 1]).toBeCloseTo(1, 5);
  });

  it("extrude needs whole faces", () => {
    expect(extrudeRegion(cube(), new Set([0]))).toBeNull();
  });

  it("the centre of an offset shape is found", () => {
    const moved = transformShape(cube(), new THREE.Matrix4().makeTranslation(2, 3, 4));
    expect(shapeCenter(moved).toArray()).toEqual([2, 3, 4]);
  });

  it("an oversized mesh is decimated under the contract's limit", () => {
    const big = shapeFromGeometry(new THREE.SphereGeometry(1, 260, 130));
    expect(fitsLimits(big)).toBe(false);
    const fitted = decimateToFit(big);
    expect(fitsLimits(fitted)).toBe(true);
    expect(vertexCount(fitted)).toBeGreaterThan(MAX_VERTICES * 0.8);
  }, 60_000);
});
