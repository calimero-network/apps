import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SimplifyModifier } from "three/examples/jsm/modifiers/SimplifyModifier.js";
import { MAX_TRIANGLES, MAX_VERTICES } from "./model";

/** The plain shape of a mesh: what the contract stores, minus the bookkeeping. */
export interface MeshShape {
  positions: number[];
  indices: number[];
}

// ── Primitives ──────────────────────────────────────────────────────────────

/**
 * The unit-sized geometry for a primitive kind, centred on the origin. Size is
 * the object's scale, exactly as a freshly added primitive in any modeller.
 * `null` for kinds with no surface of their own (groups, lights, meshes).
 */
export function primitiveGeometry(kind: string, segments: number): THREE.BufferGeometry | null {
  const s = Math.max(3, Math.min(128, Math.round(segments)));
  switch (kind) {
    case "cube":
      return new THREE.BoxGeometry(1, 1, 1);
    case "sphere":
      return new THREE.SphereGeometry(0.5, s, Math.max(2, Math.round(s / 2)));
    case "icosphere":
      // `segments` is the subdivision level here, 3 → 2. Beyond 6 the vertex
      // count passes what one mesh may hold once converted.
      return new THREE.IcosahedronGeometry(0.5, Math.min(6, Math.max(0, s - 1)));
    case "cylinder":
      return new THREE.CylinderGeometry(0.5, 0.5, 1, s);
    case "cone":
      return new THREE.ConeGeometry(0.5, 1, s);
    case "torus":
      return new THREE.TorusGeometry(0.375, 0.125, Math.max(3, Math.round(s / 2)), s);
    case "plane": {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      return g;
    }
    case "capsule":
      return new THREE.CapsuleGeometry(0.25, 0.5, Math.max(2, Math.round(s / 4)), s);
    default:
      return null;
  }
}

// ── Mesh data ⇄ geometry ────────────────────────────────────────────────────

export function geometryFromShape(shape: MeshShape): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(shape.positions, 3));
  g.setIndex(shape.indices.slice());
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Any geometry as a welded, indexed triangle list.
 *
 * Normals and UVs are dropped BEFORE welding on purpose: a primitive's seams
 * and hard edges are separate vertices that differ only in those attributes,
 * and leaving them would let an edit-mode drag tear the surface open along
 * every seam.
 */
export function shapeFromGeometry(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4): MeshShape {
  let g = geometry.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== "position") g.deleteAttribute(name);
  }
  g.morphAttributes = {};
  if (matrix) g.applyMatrix4(matrix);
  g = mergeVertices(g, 1e-5);
  const pos = g.getAttribute("position");
  const positions = Array.from(pos.array as ArrayLike<number>).slice(0, pos.count * 3);
  let indices: number[];
  const index = g.getIndex();
  if (index) {
    indices = Array.from(index.array as ArrayLike<number>);
  } else {
    indices = Array.from({ length: pos.count }, (_, i) => i);
  }
  g.dispose();
  return compact({ positions: roundAll(positions), indices: dropDegenerate(indices) });
}

/** Float32 noise like 0.49999997 makes JSON large and diffs unreadable; six places is plenty. */
function roundAll(values: number[]): number[] {
  return values.map((v) => Math.round(v * 1e6) / 1e6);
}

export function vertexCount(shape: MeshShape): number {
  return shape.positions.length / 3;
}

export function triangleCount(shape: MeshShape): number {
  return shape.indices.length / 3;
}

export function fitsLimits(shape: MeshShape): boolean {
  return vertexCount(shape) <= MAX_VERTICES && triangleCount(shape) <= MAX_TRIANGLES;
}

/** Collapse edges until the mesh has at most `vertices` vertices. */
export function decimate(shape: MeshShape, vertices: number): MeshShape {
  const remove = vertexCount(shape) - vertices;
  if (remove <= 0) return shape;
  const geometry = geometryFromShape(shape);
  geometry.deleteAttribute("normal");
  const simplified = new SimplifyModifier().modify(geometry, remove);
  const out = shapeFromGeometry(simplified);
  geometry.dispose();
  simplified.dispose();
  return out;
}

/** Bring a mesh under the contract's limits. Returns the shape unchanged when it already fits. */
export function decimateToFit(shape: MeshShape): MeshShape {
  if (fitsLimits(shape)) return shape;
  // Vertices and triangles go down together (about two triangles a vertex),
  // and a little past the limit, so welding afterwards cannot tip it back over.
  const byTriangles = Math.floor(MAX_TRIANGLES / 2);
  const target = Math.floor(Math.min(MAX_VERTICES, byTriangles) * 0.97);
  return decimate(shape, target);
}

// ── Mesh operations ─────────────────────────────────────────────────────────
//
// All pure: a shape in, a new shape out. Every one of them is something a
// person does to a mesh in edit mode, and each result is what gets written to
// the contract with `put_mesh`.

/** Remove vertices no triangle uses, renumbering the rest. */
export function compact(shape: MeshShape): MeshShape {
  const used = new Map<number, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  for (const i of shape.indices) {
    let j = used.get(i);
    if (j === undefined) {
      j = used.size;
      used.set(i, j);
      positions.push(shape.positions[i * 3]!, shape.positions[i * 3 + 1]!, shape.positions[i * 3 + 2]!);
    }
    indices.push(j);
  }
  return { positions, indices };
}

function dropDegenerate(indices: number[]): number[] {
  const out: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  return out;
}

/** Bake a transform into the vertices. */
export function transformShape(shape: MeshShape, matrix: THREE.Matrix4): MeshShape {
  const v = new THREE.Vector3();
  const positions = shape.positions.slice();
  for (let i = 0; i < positions.length; i += 3) {
    v.set(positions[i]!, positions[i + 1]!, positions[i + 2]!).applyMatrix4(matrix);
    positions[i] = v.x;
    positions[i + 1] = v.y;
    positions[i + 2] = v.z;
  }
  // A mirroring transform turns every triangle inside out; flip them back.
  const indices = matrix.determinant() < 0 ? flipIndices(shape.indices) : shape.indices.slice();
  return { positions: roundAll(positions), indices };
}

function flipIndices(indices: number[]): number[] {
  const out = indices.slice();
  for (let t = 0; t < out.length; t += 3) {
    const b = out[t + 1]!;
    out[t + 1] = out[t + 2]!;
    out[t + 2] = b;
  }
  return out;
}

/** Turn every face inside out. */
export function flipNormals(shape: MeshShape): MeshShape {
  return { positions: shape.positions.slice(), indices: flipIndices(shape.indices) };
}

/** Several shapes, each already in the target space, as one. */
export function joinShapes(shapes: MeshShape[]): MeshShape {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const s of shapes) {
    const base = positions.length / 3;
    positions.push(...s.positions);
    for (const i of s.indices) indices.push(i + base);
  }
  return { positions, indices };
}

/** The centre of a shape's bounding box. */
export function shapeCenter(shape: MeshShape): THREE.Vector3 {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < shape.positions.length; i += 3) {
    box.expandByPoint(v.set(shape.positions[i]!, shape.positions[i + 1]!, shape.positions[i + 2]!));
  }
  return box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
}

/**
 * Split every triangle into four at its edge midpoints. Shared edges share
 * their midpoint, so the surface stays closed.
 */
export function subdivide(shape: MeshShape): MeshShape {
  const positions = shape.positions.slice();
  const mid = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    let m = mid.get(key);
    if (m === undefined) {
      m = positions.length / 3;
      for (let k = 0; k < 3; k += 1) {
        positions.push((shape.positions[a * 3 + k]! + shape.positions[b * 3 + k]!) / 2);
      }
      mid.set(key, m);
    }
    return m;
  };
  const indices: number[] = [];
  for (let t = 0; t < shape.indices.length; t += 3) {
    const a = shape.indices[t]!;
    const b = shape.indices[t + 1]!;
    const c = shape.indices[t + 2]!;
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    indices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  return { positions: roundAll(positions), indices };
}

/**
 * Laplacian smoothing: pull each vertex toward the average of its neighbours.
 * `only` limits it to a set of vertices (edit mode); otherwise every vertex moves.
 */
export function smooth(shape: MeshShape, strength = 0.5, iterations = 1, only?: Set<number>): MeshShape {
  const n = vertexCount(shape);
  const neighbours: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t < shape.indices.length; t += 3) {
    const a = shape.indices[t]!;
    const b = shape.indices[t + 1]!;
    const c = shape.indices[t + 2]!;
    neighbours[a]!.add(b).add(c);
    neighbours[b]!.add(a).add(c);
    neighbours[c]!.add(a).add(b);
  }
  let positions = shape.positions.slice();
  for (let it = 0; it < iterations; it += 1) {
    const next = positions.slice();
    for (let i = 0; i < n; i += 1) {
      if (only && !only.has(i)) continue;
      const ns = neighbours[i]!;
      if (ns.size === 0) continue;
      for (let k = 0; k < 3; k += 1) {
        let sum = 0;
        for (const j of ns) sum += positions[j * 3 + k]!;
        const avg = sum / ns.size;
        next[i * 3 + k] = positions[i * 3 + k]! + (avg - positions[i * 3 + k]!) * strength;
      }
    }
    positions = next;
  }
  return { positions: roundAll(positions), indices: shape.indices.slice() };
}

/**
 * Weld vertices closer than `distance` (all of them, or only those in `only`).
 * Triangles that collapse are removed.
 */
export function mergeByDistance(shape: MeshShape, distance = 1e-4, only?: Set<number>): MeshShape {
  const n = vertexCount(shape);
  const cell = Math.max(distance, 1e-9);
  const grid = new Map<string, number[]>();
  const remap = new Int32Array(n).map((_, i) => i);
  const p = shape.positions;
  for (let i = 0; i < n; i += 1) {
    if (only && !only.has(i)) continue;
    const x = p[i * 3]!;
    const y = p[i * 3 + 1]!;
    const z = p[i * 3 + 2]!;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    let found = -1;
    search: for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const ex = p[j * 3]! - x;
            const ey = p[j * 3 + 1]! - y;
            const ez = p[j * 3 + 2]! - z;
            if (ex * ex + ey * ey + ez * ez <= distance * distance) {
              found = j;
              break search;
            }
          }
        }
      }
    }
    if (found >= 0) {
      remap[i] = found;
    } else {
      const key = `${cx},${cy},${cz}`;
      const list = grid.get(key) ?? [];
      list.push(i);
      grid.set(key, list);
    }
  }
  const indices = dropDegenerate(shape.indices.map((i) => remap[i]!));
  return compact({ positions: shape.positions, indices });
}

/** Remove vertices and every triangle that uses one of them. */
export function deleteVertices(shape: MeshShape, doomed: Set<number>): MeshShape {
  const indices: number[] = [];
  for (let t = 0; t < shape.indices.length; t += 3) {
    const a = shape.indices[t]!;
    const b = shape.indices[t + 1]!;
    const c = shape.indices[t + 2]!;
    if (!doomed.has(a) && !doomed.has(b) && !doomed.has(c)) indices.push(a, b, c);
  }
  return compact({ positions: shape.positions, indices });
}

/**
 * Extrude the faces whose three corners are all selected.
 *
 * The region is copied and pushed out along its average normal by `distance`,
 * and its boundary is stitched to the original with side walls, so the result
 * is closed wherever the input was. Returns the new shape and the indices of
 * the moved copy — the new selection, ready to be dragged further.
 */
export function extrudeRegion(
  shape: MeshShape,
  selected: Set<number>,
  distance = 0.25,
): { shape: MeshShape; selection: Set<number> } | null {
  const region: number[] = [];
  const rest: number[] = [];
  for (let t = 0; t < shape.indices.length; t += 3) {
    const tri = [shape.indices[t]!, shape.indices[t + 1]!, shape.indices[t + 2]!];
    (tri.every((i) => selected.has(i)) ? region : rest).push(...tri);
  }
  if (region.length === 0) return null;

  // Average normal of the region, area-weighted by the cross product.
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const at = (i: number, v: THREE.Vector3) =>
    v.set(shape.positions[i * 3]!, shape.positions[i * 3 + 1]!, shape.positions[i * 3 + 2]!);
  for (let t = 0; t < region.length; t += 3) {
    at(region[t]!, a);
    at(region[t + 1]!, b);
    at(region[t + 2]!, c);
    normal.add(b.sub(a).cross(c.sub(a)));
  }
  if (normal.lengthSq() < 1e-12) normal.set(0, 1, 0);
  normal.normalize().multiplyScalar(distance);

  // Directed edges that appear once in the region are its boundary.
  const edges = new Map<string, [number, number]>();
  for (let t = 0; t < region.length; t += 3) {
    for (let k = 0; k < 3; k += 1) {
      const u = region[t + k]!;
      const v = region[t + ((k + 1) % 3)]!;
      const reverse = `${v}_${u}`;
      if (edges.has(reverse)) edges.delete(reverse);
      else edges.set(`${u}_${v}`, [u, v]);
    }
  }

  const positions = shape.positions.slice();
  const copy = new Map<number, number>();
  const moved = (i: number): number => {
    let j = copy.get(i);
    if (j === undefined) {
      j = positions.length / 3;
      positions.push(
        shape.positions[i * 3]! + normal.x,
        shape.positions[i * 3 + 1]! + normal.y,
        shape.positions[i * 3 + 2]! + normal.z,
      );
      copy.set(i, j);
    }
    return j;
  };
  const indices = rest.slice();
  for (const i of region) indices.push(moved(i));
  for (const [u, v] of edges.values()) {
    const u2 = moved(u);
    const v2 = moved(v);
    indices.push(u, v, v2, u, v2, u2);
  }
  // `compact` renumbers, so the selection is carried through by position in
  // the vertex list: mark the copies, compact, and read the marks back.
  const marked = new Set(copy.values());
  const used = new Map<number, number>();
  const outPositions: number[] = [];
  const outIndices: number[] = [];
  for (const i of indices) {
    let j = used.get(i);
    if (j === undefined) {
      j = used.size;
      used.set(i, j);
      outPositions.push(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
    }
    outIndices.push(j);
  }
  const selection = new Set<number>();
  for (const [from, to] of used) if (marked.has(from)) selection.add(to);
  return { shape: { positions: roundAll(outPositions), indices: outIndices }, selection };
}
