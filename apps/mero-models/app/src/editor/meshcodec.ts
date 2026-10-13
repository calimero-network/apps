import { deflateSync, inflateSync } from "fflate";
import type { MeshShape } from "./geometry";

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
 * The contract cannot read this; it stores what the writer SAYS is inside.
 * So decoding validates everything — counts against the reference, every
 * index in range, every coordinate finite — and a blob that fails is refused
 * rather than drawn.
 */
export const MESH_MAGIC = "MMSH";
export const MESH_FORMAT = 1;
const HEADER = 20;
const FLAG_UVS = 1;

export function encodeMesh(shape: MeshShape): Uint8Array {
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
