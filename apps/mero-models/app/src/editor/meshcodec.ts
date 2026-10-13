import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import type { MeshShape } from "./geometry";
import { canonicalModifier, parseModifier } from "./modifiers";
import { edgeEnds, edgeKey, triangleTotal, vertexTotal, type Modifier, type Poly } from "./poly";
import { shapeFromPoly } from "./polymesh";

/**
 * The mesh blob format — what a `MeshRef.blob_id` names.
 *
 *   offset  size  field
 *   0       4     magic "MMSH"
 *   4       4     format version (1), u32 LE
 *   8       4     flags, u32 LE — bit 0: has UVs
 *   12      4     vertex count, u32 LE
 *   16      4     index count, u32 LE
 *   20      …     deflate( positions f32[v*3] ‖ indices u32[n] ‖ uvs f32[v*2] ), all LE
 *
 * Deterministic on purpose: the same shape always encodes to the same bytes,
 * and the node's blob id is the hash of the bytes, so re-saving an unchanged
 * mesh (an undo, a restore) uploads nothing new.
 *
 * Format 2 holds a polygon cage instead (see `poly.ts`), and the triangles
 * are derived from it on read:
 *
 *   offset  size  field
 *   0       4     magic "MMSH"
 *   4       4     format version (2), u32 LE
 *   8       4     flags, u32 LE — bit 0: has UVs
 *   12      4     vertex count
 *   16      4     face count
 *   20      4     corner count (the sum of the face sizes)
 *   24      4     sharp edge count
 *   28      4     modifier stack length in bytes
 *   32      …     deflate( positions f32[v*3] ‖ face sizes u32[f] ‖ corners u32[c]
 *                          ‖ uvs f32[c*2] ‖ sharp edges u32[s*2] ‖ modifiers JSON )
 *
 * A mesh without a cage is still written as format 1, so a triangle mesh
 * imported from a DCC is byte-for-byte what it was. For a format-2 blob the
 * reference's `vertex_count` is the cage's vertices and `triangle_count` the
 * triangles its faces make (n − 2 each) — both read straight off the header.
 *
 * The contract cannot read this; it stores what the writer SAYS is inside.
 * So decoding validates everything — counts against the reference, every
 * index in range, every coordinate finite — and a blob that fails is refused
 * rather than drawn.
 */
export const MESH_MAGIC = "MMSH";
export const MESH_FORMAT = 1;
export const POLY_FORMAT = 2;
const HEADER = 20;
const POLY_HEADER = 32;
const FLAG_UVS = 1;

/** What a mesh's reference says it holds. */
export function meshCounts(shape: MeshShape): { vertex_count: number; triangle_count: number } {
  if (shape.poly) return { vertex_count: vertexTotal(shape.poly), triangle_count: triangleTotal(shape.poly) };
  return { vertex_count: shape.positions.length / 3, triangle_count: shape.indices.length / 3 };
}

export function encodeMesh(shape: MeshShape): Uint8Array {
  if (shape.poly) return encodePoly(shape.poly);
  const v = shape.positions.length / 3;
  const n = shape.indices.length;
  const hasUvs = !!shape.uvs && shape.uvs.length === v * 2;
  const bodyBytes = v * 12 + n * 4 + (hasUvs ? v * 8 : 0);
  const body = new Uint8Array(bodyBytes);
  const view = new DataView(body.buffer);
  let o = 0;
  for (let i = 0; i < shape.positions.length; i += 1, o += 4) view.setFloat32(o, shape.positions[i]!, true);
  for (let i = 0; i < n; i += 1, o += 4) view.setUint32(o, shape.indices[i]!, true);
  if (hasUvs) for (let i = 0; i < v * 2; i += 1, o += 4) view.setFloat32(o, shape.uvs![i]!, true);
  const packed = deflateSync(body, { level: 6 });
  const out = new Uint8Array(HEADER + packed.length);
  const head = new DataView(out.buffer);
  for (let i = 0; i < 4; i += 1) out[i] = MESH_MAGIC.charCodeAt(i);
  head.setUint32(4, MESH_FORMAT, true);
  head.setUint32(8, hasUvs ? FLAG_UVS : 0, true);
  head.setUint32(12, v, true);
  head.setUint32(16, n, true);
  out.set(packed, HEADER);
  return out;
}

export class MeshDecodeError extends Error {}

/** Decode and validate. `expect` is the reference's claim, checked against the blob. */
export function decodeMesh(
  bytes: ArrayBuffer | Uint8Array,
  expect?: { vertex_count: number; triangle_count: number },
): MeshShape {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length < HEADER) throw new MeshDecodeError("not a mesh blob: too short");
  const magic = String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!);
  if (magic !== MESH_MAGIC) throw new MeshDecodeError("not a mesh blob: wrong magic");
  const head = new DataView(data.buffer, data.byteOffset, HEADER);
  const format = head.getUint32(4, true);
  if (format === POLY_FORMAT) return shapeFromPoly(decodePoly(data, expect));
  if (format !== MESH_FORMAT) throw new MeshDecodeError(`mesh format ${format} is newer than this app`);
  const hasUvs = (head.getUint32(8, true) & FLAG_UVS) !== 0;
  const v = head.getUint32(12, true);
  const n = head.getUint32(16, true);
  if (n % 3 !== 0) throw new MeshDecodeError("index count is not a whole number of triangles");
  if (expect && (expect.vertex_count !== v || expect.triangle_count !== n / 3)) {
    throw new MeshDecodeError(
      `the blob holds ${v} vertices and ${n / 3} triangles, but its reference says ${expect.vertex_count} and ${expect.triangle_count}`,
    );
  }
  const want = v * 12 + n * 4 + (hasUvs ? v * 8 : 0);
  let body: Uint8Array;
  try {
    body = inflateSync(data.subarray(HEADER), { out: new Uint8Array(want) });
  } catch {
    throw new MeshDecodeError("the mesh blob is corrupt");
  }
  if (body.length !== want) throw new MeshDecodeError("the mesh blob is truncated");
  const view = new DataView(body.buffer, body.byteOffset, body.length);
  const positions = new Float32Array(v * 3);
  let o = 0;
  for (let i = 0; i < v * 3; i += 1, o += 4) {
    const x = view.getFloat32(o, true);
    if (!Number.isFinite(x)) throw new MeshDecodeError("a vertex position is not a finite number");
    positions[i] = x;
  }
  const indices = new Uint32Array(n);
  for (let i = 0; i < n; i += 1, o += 4) {
    const k = view.getUint32(o, true);
    if (k >= v) throw new MeshDecodeError("a triangle refers to a vertex the mesh does not have");
    indices[i] = k;
  }
  if (!hasUvs) return { positions, indices };
  const uvs = new Float32Array(v * 2);
  for (let i = 0; i < v * 2; i += 1, o += 4) uvs[i] = view.getFloat32(o, true);
  return { positions, indices, uvs };
}

function encodePoly(p: Poly): Uint8Array {
  const v = p.positions.length / 3;
  const f = p.faces.length;
  const c = p.faces.reduce((n, face) => n + face.length, 0);
  // Sorted, so the same cage always makes the same bytes.
  const sharp = [...p.sharp].sort((a, b) => a - b);
  const mods = strToU8(JSON.stringify(p.modifiers.map(canonicalModifier)));
  const uvs = !!p.uvs;
  const body = new Uint8Array(v * 12 + f * 4 + c * 4 + (uvs ? c * 8 : 0) + sharp.length * 8 + mods.length);
  const view = new DataView(body.buffer);
  let o = 0;
  for (const x of p.positions) (view.setFloat32(o, x, true), (o += 4));
  for (const face of p.faces) (view.setUint32(o, face.length, true), (o += 4));
  for (const face of p.faces) for (const k of face) (view.setUint32(o, k, true), (o += 4));
  if (uvs) for (const uv of p.uvs!) for (const x of uv) (view.setFloat32(o, x, true), (o += 4));
  for (const key of sharp) {
    const [a, b] = edgeEnds(key);
    view.setUint32(o, a, true);
    view.setUint32(o + 4, b, true);
    o += 8;
  }
  body.set(mods, o);
  const packed = deflateSync(body, { level: 6 });
  const out = new Uint8Array(POLY_HEADER + packed.length);
  const head = new DataView(out.buffer);
  for (let i = 0; i < 4; i += 1) out[i] = MESH_MAGIC.charCodeAt(i);
  head.setUint32(4, POLY_FORMAT, true);
  head.setUint32(8, uvs ? FLAG_UVS : 0, true);
  head.setUint32(12, v, true);
  head.setUint32(16, f, true);
  head.setUint32(20, c, true);
  head.setUint32(24, sharp.length, true);
  head.setUint32(28, mods.length, true);
  out.set(packed, POLY_HEADER);
  return out;
}

function decodePoly(data: Uint8Array, expect?: { vertex_count: number; triangle_count: number }): Poly {
  if (data.length < POLY_HEADER) throw new MeshDecodeError("the mesh blob is truncated");
  const head = new DataView(data.buffer, data.byteOffset, POLY_HEADER);
  const hasUvs = (head.getUint32(8, true) & FLAG_UVS) !== 0;
  const v = head.getUint32(12, true);
  const f = head.getUint32(16, true);
  const c = head.getUint32(20, true);
  const s = head.getUint32(24, true);
  const m = head.getUint32(28, true);
  if (c < f * 3) throw new MeshDecodeError("a face has fewer than three corners");
  if (expect && (expect.vertex_count !== v || expect.triangle_count !== c - 2 * f)) {
    throw new MeshDecodeError(
      `the blob holds ${v} vertices and ${c - 2 * f} triangles, but its reference says ${expect.vertex_count} and ${expect.triangle_count}`,
    );
  }
  if (m > 1 << 16) throw new MeshDecodeError("the modifier stack is implausibly large");
  const want = v * 12 + f * 4 + c * 4 + (hasUvs ? c * 8 : 0) + s * 8 + m;
  let body: Uint8Array;
  try {
    body = inflateSync(data.subarray(POLY_HEADER), { out: new Uint8Array(want) });
  } catch {
    throw new MeshDecodeError("the mesh blob is corrupt");
  }
  if (body.length !== want) throw new MeshDecodeError("the mesh blob is truncated");
  const view = new DataView(body.buffer, body.byteOffset, body.length);
  let o = 0;
  const positions = new Array<number>(v * 3);
  for (let i = 0; i < v * 3; i += 1, o += 4) {
    const x = view.getFloat32(o, true);
    if (!Number.isFinite(x)) throw new MeshDecodeError("a vertex position is not a finite number");
    positions[i] = x;
  }
  const sizes: number[] = [];
  let total = 0;
  for (let i = 0; i < f; i += 1, o += 4) {
    const n = view.getUint32(o, true);
    if (n < 3) throw new MeshDecodeError("a face has fewer than three corners");
    sizes.push(n);
    total += n;
  }
  if (total !== c) throw new MeshDecodeError("the face sizes do not add up to the corner count");
  const faces: number[][] = [];
  for (const n of sizes) {
    const face: number[] = [];
    for (let i = 0; i < n; i += 1, o += 4) {
      const k = view.getUint32(o, true);
      if (k >= v) throw new MeshDecodeError("a face refers to a vertex the mesh does not have");
      face.push(k);
    }
    faces.push(face);
  }
  let uvs: number[][] | null = null;
  if (hasUvs) {
    uvs = sizes.map((n) => {
      const uv: number[] = [];
      for (let i = 0; i < n * 2; i += 1, o += 4) uv.push(view.getFloat32(o, true));
      return uv;
    });
  }
  const sharp = new Set<number>();
  for (let i = 0; i < s; i += 1, o += 8) {
    const a = view.getUint32(o, true);
    const b = view.getUint32(o + 4, true);
    if (a >= v || b >= v || a === b) throw new MeshDecodeError("a sharp edge refers to a vertex the mesh does not have");
    sharp.add(edgeKey(a, b));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(body.subarray(o, o + m)));
  } catch {
    throw new MeshDecodeError("the modifier stack is not valid JSON");
  }
  if (!Array.isArray(raw) || raw.length > 16) throw new MeshDecodeError("the modifier stack is not a list of at most 16");
  const modifiers: Modifier[] = raw.map((x) => {
    const mod = parseModifier(x);
    if (!mod) throw new MeshDecodeError("the modifier stack holds a modifier this app does not know, or one out of range");
    return mod;
  });
  return { positions, faces, uvs, sharp, modifiers };
}
