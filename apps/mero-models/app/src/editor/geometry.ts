import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SimplifyModifier } from "three/examples/jsm/modifiers/SimplifyModifier.js";
import { MAX_TRIANGLES, MAX_VERTICES } from "./model";

/**
 * A triangle mesh in its own space: what a mesh blob holds.
 *
 * Typed arrays rather than `number[]`: a production mesh is millions of
 * floats, and a plain array of them is several times the memory and has to be
 * converted again for every upload and every draw.
 *
 * `uvs` are per vertex. A mesh imported with UVs keeps them, split at its UV
 * seams (two vertices at one position with different UVs); edit mode moves the
 * vertices at one position together, so a seam never tears (`colocated`).
 */
export interface MeshShape {
  positions: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array;
}

export function makeShape(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  uvs?: ArrayLike<number> | null,
): MeshShape {
  const shape: MeshShape = {
    positions: positions instanceof Float32Array ? positions : Float32Array.from(positions),
    indices: indices instanceof Uint32Array ? indices : Uint32Array.from(indices),
  };
  if (uvs && uvs.length) shape.uvs = uvs instanceof Float32Array ? uvs : Float32Array.from(uvs);
  return shape;
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
      // `segments` is the subdivision level here, 3 → 2.
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

/**
 * A drawable geometry. A mesh without UVs gets box-projected ones when
 * `boxUvs` is set, so a texture still lands on it sensibly.
 */
export function geometryFromShape(shape: MeshShape, boxUvs = false): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(shape.positions, 3));
  g.setIndex(new THREE.BufferAttribute(shape.indices, 1));
  const uvs = shape.uvs ?? (boxUvs ? boxProjectUvs(shape) : null);
  if (uvs) g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  if (uvs && shape.uvs) g.computeTangents?.();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * UVs from the axis each vertex's faces mostly look along — a box projection,
 * scaled to the mesh's bounds so each side of a box shows the whole image once.
 */
export function boxProjectUvs(shape: MeshShape): Float32Array {
  const n = vertexCount(shape);
  const normal = new Float32Array(n * 3);
  const p = shape.positions;
  const idx = shape.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3;
    const b = idx[t + 1]! * 3;
    const c = idx[t + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      normal[i] = normal[i]! + nx;
      normal[i + 1] = normal[i + 1]! + ny;
      normal[i + 2] = normal[i + 2]! + nz;
    }
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k]!, p[i + k]!);
      max[k] = Math.max(max[k]!, p[i + k]!);
    }
  }
  const span = max.map((m, k) => m - min[k]! || 1);
  const along = (i: number, k: number) => (p[i * 3 + k]! - min[k]!) / span[k]!;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 1) {
    const ax = Math.abs(normal[i * 3]!), ay = Math.abs(normal[i * 3 + 1]!), az = Math.abs(normal[i * 3 + 2]!);
    const [u, v] = ax >= ay && ax >= az ? [2, 1] : ay >= az ? [0, 2] : [0, 1];
    uv[i * 2] = along(i, u);
    uv[i * 2 + 1] = along(i, v);
  }
  return uv;
}

/**
 * Any geometry as an indexed triangle list, welded.
 *
 * Without `keepUvs`, normals and UVs are dropped BEFORE welding: a primitive's
 * seams and hard edges are separate vertices that differ only in those, and
 * keeping them would let an edit-mode drag tear the surface along every seam.
 * With `keepUvs` (an imported, textured model) vertices weld only where both
 * position and UV agree, so the UV layout survives.
 */
export function shapeFromGeometry(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4, keepUvs = false): MeshShape {
  let g = geometry.clone();
  const withUvs = keepUvs && !!g.getAttribute("uv");
  for (const name of Object.keys(g.attributes)) {
    if (name !== "position" && !(withUvs && name === "uv")) g.deleteAttribute(name);
  }
  g.morphAttributes = {};
  if (matrix) g.applyMatrix4(matrix);
  g = mergeVertices(g, 1e-5);
  const pos = g.getAttribute("position");
  const positions = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
  }
  let uvs: Float32Array | undefined;
  const uvAttr = withUvs ? g.getAttribute("uv") : null;
  if (uvAttr) {
    uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i += 1) {
      uvs[i * 2] = uvAttr.getX(i);
      uvs[i * 2 + 1] = uvAttr.getY(i);
    }
  }
  const index = g.getIndex();
  const indices = index ? Uint32Array.from(index.array as ArrayLike<number>) : Uint32Array.from({ length: pos.count }, (_, i) => i);
  // A mirroring transform turns every triangle inside out; flip them back.
  if (matrix && matrix.determinant() < 0) flipInPlace(indices);
  g.dispose();
  return compact({ positions, indices: dropDegenerate(indices), uvs });
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

/** Collapse edges until the mesh has at most `vertices` vertices. Drops UVs. */
export function decimate(shape: MeshShape, vertices: number): MeshShape {
  const remove = vertexCount(shape) - vertices;
  if (remove <= 0) return shape;
  const geometry = geometryFromShape({ positions: shape.positions, indices: shape.indices });
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
  const byTriangles = Math.floor(MAX_TRIANGLES / 2);
  const target = Math.floor(Math.min(MAX_VERTICES, byTriangles) * 0.97);
  return decimate(shape, target);
}

/**
 * For each vertex, the lowest index of a vertex at exactly the same position.
 * Edit mode selects through this, so picking one side of a UV seam moves both.
 */
export function colocated(shape: MeshShape): Int32Array {
  const n = vertexCount(shape);
  const out = new Int32Array(n);
  const seen = new Map<string, number>();
  const p = shape.positions;
  for (let i = 0; i < n; i += 1) {
    const key = `${p[i * 3]},${p[i * 3 + 1]},${p[i * 3 + 2]}`;
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, i);
      out[i] = i;
    } else {
      out[i] = first;
    }
  }
  return out;
}

// ── Mesh operations ─────────────────────────────────────────────────────────
//
// All pure: a shape in, a new shape out. Every one of them is something a
// person does to a mesh, and each result becomes a new mesh blob and version.

/** Remove vertices no triangle uses, renumbering the rest. Keeps UVs. */
export function compact(shape: MeshShape): MeshShape {
  const n = vertexCount(shape);
  const remap = new Int32Array(n).fill(-1);
  let next = 0;
  for (const i of shape.indices) if (remap[i] === -1) remap[i] = next++;
  const positions = new Float32Array(next * 3);
  const uvs = shape.uvs ? new Float32Array(next * 2) : undefined;
  for (let i = 0; i < n; i += 1) {
    const j = remap[i]!;
    if (j < 0) continue;
    positions[j * 3] = shape.positions[i * 3]!;
    positions[j * 3 + 1] = shape.positions[i * 3 + 1]!;
    positions[j * 3 + 2] = shape.positions[i * 3 + 2]!;
    if (uvs) {
      uvs[j * 2] = shape.uvs![i * 2]!;
      uvs[j * 2 + 1] = shape.uvs![i * 2 + 1]!;
    }
  }
  const indices = new Uint32Array(shape.indices.length);
  for (let k = 0; k < indices.length; k += 1) indices[k] = remap[shape.indices[k]!]!;
  return uvs ? { positions, indices, uvs } : { positions, indices };
}

function dropDegenerate(indices: Uint32Array): Uint32Array {
  const out = new Uint32Array(indices.length);
  let k = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    if (a !== b && b !== c && a !== c) {
      out[k++] = a;
      out[k++] = b;
      out[k++] = c;
    }
  }
  return out.slice(0, k);
}

function flipInPlace(indices: Uint32Array): Uint32Array {
  for (let t = 0; t < indices.length; t += 3) {
    const b = indices[t + 1]!;
    indices[t + 1] = indices[t + 2]!;
    indices[t + 2] = b;
  }
  return indices;
}

/** Bake a transform into the vertices. */
export function transformShape(shape: MeshShape, matrix: THREE.Matrix4): MeshShape {
  const e = matrix.elements;
  const src = shape.positions;
  const positions = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i]!, y = src[i + 1]!, z = src[i + 2]!;
    const w = 1 / (e[3]! * x + e[7]! * y + e[11]! * z + e[15]!);
    positions[i] = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) * w;
    positions[i + 1] = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) * w;
    positions[i + 2] = (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * w;
  }
  const indices = shape.indices.slice();
  if (matrix.determinant() < 0) flipInPlace(indices);
  return withUvs({ positions, indices }, shape.uvs?.slice());
}

function withUvs(shape: MeshShape, uvs: Float32Array | undefined): MeshShape {
  return uvs ? { ...shape, uvs } : shape;
}

/** Turn every face inside out. */
export function flipNormals(shape: MeshShape): MeshShape {
  return withUvs({ positions: shape.positions.slice(), indices: flipInPlace(shape.indices.slice()) }, shape.uvs?.slice());
}

/** Several shapes, each already in the target space, as one. UVs survive only if every part has them. */
export function joinShapes(shapes: MeshShape[]): MeshShape {
  const vertices = shapes.reduce((n, s) => n + vertexCount(s), 0);
  const tris = shapes.reduce((n, s) => n + s.indices.length, 0);
  const allUvs = shapes.length > 0 && shapes.every((s) => s.uvs);
  const positions = new Float32Array(vertices * 3);
  const indices = new Uint32Array(tris);
  const uvs = allUvs ? new Float32Array(vertices * 2) : undefined;
  let base = 0;
  let k = 0;
  for (const s of shapes) {
    positions.set(s.positions, base * 3);
    if (uvs) uvs.set(s.uvs!, base * 2);
    for (const i of s.indices) indices[k++] = i + base;
    base += vertexCount(s);
  }
  return withUvs({ positions, indices }, uvs);
}

/** The centre of a shape's bounding box. */
export function shapeCenter(shape: MeshShape): THREE.Vector3 {
  const p = shape.positions;
  if (!p.length) return new THREE.Vector3();
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]!, y = p[i + 1]!, z = p[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
}

/** A key for an undirected edge, as a number (vertex indices stay well under 2^26). */
const edgeKey = (a: number, b: number) => (a < b ? a * 67_108_864 + b : b * 67_108_864 + a);

/**
 * Split every triangle into four at its edge midpoints. Shared edges share
 * their midpoint, so the surface stays closed; UVs are interpolated.
 */
export function subdivide(shape: MeshShape): MeshShape {
  const tris = shape.indices.length / 3;
  const positions: number[] = Array.from(shape.positions);
  const uvs: number[] | null = shape.uvs ? Array.from(shape.uvs) : null;
  const mid = new Map<number, number>();
  const midpoint = (a: number, b: number): number => {
    const key = edgeKey(a, b);
    let m = mid.get(key);
    if (m === undefined) {
      m = positions.length / 3;
      for (let k = 0; k < 3; k += 1) positions.push((shape.positions[a * 3 + k]! + shape.positions[b * 3 + k]!) / 2);
      if (uvs) for (let k = 0; k < 2; k += 1) uvs.push((shape.uvs![a * 2 + k]! + shape.uvs![b * 2 + k]!) / 2);
      mid.set(key, m);
    }
    return m;
  };
  const indices = new Uint32Array(tris * 12);
  let k = 0;
  for (let t = 0; t < shape.indices.length; t += 3) {
    const a = shape.indices[t]!;
    const b = shape.indices[t + 1]!;
    const c = shape.indices[t + 2]!;
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    for (const i of [a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca]) indices[k++] = i;
  }
  return makeShape(positions, indices, uvs);
}

/**
 * Laplacian smoothing: pull each vertex toward the average of its neighbours.
 * `only` limits it to a set of vertices (edit mode); otherwise every vertex moves.
 * Vertices at one position (a UV seam) move together.
 */
export function smooth(shape: MeshShape, strength = 0.5, iterations = 1, only?: Set<number>): MeshShape {
  const n = vertexCount(shape);
  const root = colocated(shape);
  // Adjacency over seam-welded vertices, so both sides of a seam agree.
  const neighbours: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t < shape.indices.length; t += 3) {
    const a = root[shape.indices[t]!]!;
    const b = root[shape.indices[t + 1]!]!;
    const c = root[shape.indices[t + 2]!]!;
    neighbours[a]!.add(b).add(c);
    neighbours[b]!.add(a).add(c);
    neighbours[c]!.add(a).add(b);
  }
  let positions = shape.positions.slice();
  for (let it = 0; it < iterations; it += 1) {
    const next = positions.slice();
    for (let i = 0; i < n; i += 1) {
      const r = root[i]!;
      if (only && !only.has(i) && !only.has(r)) continue;
      const ns = neighbours[r]!;
      if (ns.size === 0) continue;
      for (let k = 0; k < 3; k += 1) {
        let sum = 0;
        for (const j of ns) sum += positions[j * 3 + k]!;
        const avg = sum / ns.size;
        next[i * 3 + k] = positions[r * 3 + k]! + (avg - positions[r * 3 + k]!) * strength;
      }
    }
    positions = next;
  }
  return withUvs({ positions, indices: shape.indices.slice() }, shape.uvs?.slice());
}

/**
 * Weld vertices closer than `distance` (all of them, or only those in `only`).
 * Triangles that collapse are removed. Vertices with different UVs are never
 * welded, so a UV seam stays a seam.
 */
export function mergeByDistance(shape: MeshShape, distance = 1e-4, only?: Set<number>): MeshShape {
  const n = vertexCount(shape);
  const cell = Math.max(distance, 1e-9);
  const grid = new Map<string, number[]>();
  const remap = new Int32Array(n).map((_, i) => i);
  const p = shape.positions;
  const uv = shape.uvs;
  const sameUv = (i: number, j: number) =>
    !uv || (Math.abs(uv[i * 2]! - uv[j * 2]!) < 1e-6 && Math.abs(uv[i * 2 + 1]! - uv[j * 2 + 1]!) < 1e-6);
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
            if (ex * ex + ey * ey + ez * ez <= distance * distance && sameUv(i, j)) {
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
  const indices = new Uint32Array(shape.indices.length);
  for (let k = 0; k < indices.length; k += 1) indices[k] = remap[shape.indices[k]!]!;
  return compact(withUvs({ positions: shape.positions, indices: dropDegenerate(indices) }, shape.uvs));
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
  return compact(withUvs({ positions: shape.positions, indices: Uint32Array.from(indices) }, shape.uvs));
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

  const positions: number[] = Array.from(shape.positions);
  const uvs: number[] | null = shape.uvs ? Array.from(shape.uvs) : null;
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
      if (uvs) uvs.push(shape.uvs![i * 2]!, shape.uvs![i * 2 + 1]!);
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
  // `compact` renumbers; carry the selection through by marking the copies.
  const marked = new Set(copy.values());
  const full = makeShape(positions, indices, uvs);
  const remap = new Int32Array(vertexCount(full)).fill(-1);
  let next = 0;
  for (const i of full.indices) if (remap[i] === -1) remap[i] = next++;
  const selection = new Set<number>();
  for (const i of marked) if (remap[i]! >= 0) selection.add(remap[i]!);
  return { shape: compact(full), selection };
}
