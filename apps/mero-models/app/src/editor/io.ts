import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { TextureRef } from "../generated/MeroModelsClient";
import { buildScene, type TextureLookup } from "./build";
import { decimateToFit, makeShape, shapeCenter, shapeFromGeometry, transformShape, vertexCount, type MeshShape } from "./geometry";
import {
  MAP_SLOTS,
  MAX_OBJECTS,
  MAX_TEXTURE_SIDE,
  OBJECT_KINDS,
  childrenIndex,
  defaultMaterial,
  makeObject,
  newId,
  uniqueName,
  vec,
  type SceneObject,
} from "./model";
import { decodeMesh, encodeMesh } from "./meshcodec";
import { evaluate } from "./modifiers";
import { primitivePoly, shapeFromPoly } from "./polymesh";
import type { StoredMesh } from "./store";
import type { ColorSpaceName, TextureCache } from "./textures";

/** An image an import brings with it, ready to upload as a texture. */
export interface ImportedTexture {
  id: string;
  name: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  mime: string;
  colorSpace: ColorSpaceName;
}

/** What an import adds: objects (parents first), their meshes, and the textures their materials use. */
export interface Imported {
  objects: SceneObject[];
  meshes: { id: string; shape: MeshShape }[];
  textures: ImportedTexture[];
  /** Things worth telling the person: pieces decimated, a model rescaled. */
  notes: string[];
}

export const IMPORT_ACCEPT = ".obj,.stl,.glb,.gltf,.json";

/** The native scene file: what `exportScene` writes and `importFile` reads back. */
interface SceneFile {
  format: "mero-models";
  version: 1 | 2;
  objects: SceneObject[];
  /** `cage`, when present, is the mesh blob (base64, format 2): the polygon cage and its modifiers. */
  meshes: Record<string, { positions: number[]; indices: number[]; uvs?: number[]; cage?: string }>;
  /** Version 2: the textures, embedded as base64. */
  textures?: (Omit<ImportedTexture, "bytes"> & { data: string })[];
}

export async function importFile(file: File, takenNames: string[]): Promise<Imported> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const stem = file.name.replace(/\.[^.]+$/, "") || "Import";
  if (ext === "json") return importSceneFile(JSON.parse(await file.text()), takenNames);
  if (ext === "obj") return fromObject3D(new OBJLoader().parse(await file.text()), stem, takenNames, "obj");
  if (ext === "stl") {
    const geometry = new STLLoader().parse(await file.arrayBuffer());
    return fromObject3D(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()), stem, takenNames, "stl");
  }
  if (ext === "glb" || ext === "gltf") {
    const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), "");
    return fromObject3D(gltf.scene, stem, takenNames, "gltf");
  }
  throw new Error(`Cannot import .${ext} files — use OBJ, STL, glTF/GLB or a Mero Models scene (.json).`);
}

type SourceMaterial = THREE.Material & {
  color?: THREE.Color;
  metalness?: number;
  roughness?: number;
  emissive?: THREE.Color;
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  normalScale?: THREE.Vector2;
  roughnessMap?: THREE.Texture | null;
  metalnessMap?: THREE.Texture | null;
  aoMap?: THREE.Texture | null;
  emissiveMap?: THREE.Texture | null;
};

/**
 * Every mesh under `root` as a mesh object inside one new empty named after
 * the file. Each piece's world transform is baked into its vertices and its
 * origin moved to its centre, so the pieces arrive where the file put them and
 * each can be moved on its own. UVs and material textures come along.
 */
export async function fromObject3D(
  root: THREE.Object3D,
  stem: string,
  takenNames: string[],
  source: "gltf" | "obj" | "stl" = "obj",
): Promise<Imported> {
  root.updateMatrixWorld(true);
  const notes: string[] = [];
  const textures = new Map<string, Promise<ImportedTexture | null>>();
  const texture = (t: THREE.Texture | null | undefined, colorSpace: ColorSpaceName, asOrm = false): Promise<ImportedTexture | null> => {
    if (!t?.image) return Promise.resolve(null);
    const key = `${t.source?.uuid ?? t.uuid}:${asOrm}`;
    let p = textures.get(key);
    if (!p) {
      p = encodeTextureImage(t.image as CanvasImageSource, asOrm)
        .then((enc) => (enc ? { id: newId(), name: t.name || `${stem} ${colorSpace === "srgb" ? "colour" : "data"}`, colorSpace, ...enc } : null))
        .catch(() => null);
      textures.set(key, p);
    }
    return p;
  };

  const pieces: { name: string; shape: MeshShape; material: SourceMaterial | undefined }[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as SourceMaterial | undefined;
    let shape = shapeFromGeometry(mesh.geometry, mesh.matrixWorld, true);
    if (!shape.indices.length) return;
    // glTF puts V=0 at the top of an image; three (and OBJ) at the bottom.
    // Every texture in this app is drawn the three way, so flip on the way in.
    if (shape.uvs && source === "gltf") for (let i = 1; i < shape.uvs.length; i += 2) shape.uvs[i] = 1 - shape.uvs[i]!;
    const before = vertexCount(shape);
    shape = decimateToFit(shape);
    if (vertexCount(shape) < before) {
      notes.push(`${mesh.name || "A piece"} was simplified from ${before.toLocaleString()} to ${vertexCount(shape).toLocaleString()} vertices to fit.`);
    }
    pieces.push({ name: mesh.name || child.parent?.name || stem, shape, material });
  });
  if (!pieces.length) throw new Error("No meshes found in that file.");
  if (pieces.length + 1 > MAX_OBJECTS) throw new Error(`That file has ${pieces.length} meshes; a scene holds at most ${MAX_OBJECTS} objects.`);

  // Models arrive in every unit there is. One far too big or too small to see
  // is scaled to a couple of units across and said so; anything sensible is
  // left at its own size.
  const bounds = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const p of pieces) {
    for (let i = 0; i < p.shape.positions.length; i += 3) {
      bounds.expandByPoint(v.set(p.shape.positions[i]!, p.shape.positions[i + 1]!, p.shape.positions[i + 2]!));
    }
  }
  const size = bounds.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z) || 1;
  let scale = 1;
  if (longest > 50 || longest < 0.05) {
    scale = 2 / longest;
    notes.push(`The model was ${longest.toPrecision(3)} units across, so it was scaled to fit (×${scale.toPrecision(3)}).`);
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const placement = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));

  const taken = takenNames.slice();
  const group = makeObject("group", taken);
  group.name = uniqueName(stem, taken);
  taken.push(group.name);
  const out: Imported = { objects: [group], meshes: [], textures: [], notes };
  for (const p of pieces) {
    const placed = transformShape(p.shape, placement);
    const c = shapeCenter(placed);
    const local = transformShape(placed, new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    const obj = makeObject("mesh", taken);
    obj.name = uniqueName(p.name, taken);
    taken.push(obj.name);
    obj.parent = group.id;
    obj.position = vec(c.x, c.y, c.z);
    const m = p.material;
    const orm = m?.roughnessMap ?? m?.metalnessMap ?? null;
    const [base, normal, ormTex, emissive] = await Promise.all([
      texture(m?.map, "srgb"),
      texture(m?.normalMap, "linear"),
      // A metal/rough texture that is not also the occlusion map has nothing
      // meaningful in red; it is whitened so the slot reads as "no occlusion".
      texture(orm, "linear", !!orm && m?.aoMap?.source !== orm.source),
      texture(m?.emissiveMap, "srgb"),
    ]);
    obj.material = {
      ...obj.material,
      color: m?.color ? `#${m.color.getHexString()}` : defaultMaterial("mesh").color,
      metalness: clamp01(m?.metalness ?? 0),
      roughness: clamp01(m?.roughness ?? 0.55),
      emissive: m?.emissive ? `#${m.emissive.getHexString()}` : "#000000",
      flat_shading: false,
      base_color_map: base?.id ?? "",
      normal_map: normal?.id ?? "",
      normal_scale: m?.normalScale ? Math.min(10, Math.abs(m.normalScale.x)) : 1,
      orm_map: ormTex?.id ?? "",
      emissive_map: emissive?.id ?? "",
    };
    out.objects.push(obj);
    out.meshes.push({ id: obj.id, shape: local });
  }
  const unique = new Map<string, ImportedTexture>();
  for (const p of textures.values()) {
    const t = await p;
    if (t) unique.set(t.id, t);
  }
  out.textures = [...unique.values()];
  if (out.textures.length) notes.push(`${out.textures.length} texture${out.textures.length === 1 ? "" : "s"} came with it.`);
  return out;
}

/** An image as PNG bytes, scaled down to the texture limit; `whiteRed` clears the red channel to 255. */
async function encodeTextureImage(
  image: CanvasImageSource,
  whiteRed: boolean,
): Promise<{ bytes: Uint8Array; width: number; height: number; mime: string } | null> {
  const w0 = (image as { width?: number }).width ?? 0;
  const h0 = (image as { height?: number }).height ?? 0;
  if (!w0 || !h0) return null;
  const k = Math.min(1, MAX_TEXTURE_SIDE / Math.max(w0, h0));
  const width = Math.max(1, Math.round(w0 * k));
  const height = Math.max(1, Math.round(h0 * k));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, width, height);
  if (whiteRed) {
    const data = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < data.data.length; i += 4) data.data[i] = 255;
    ctx.putImageData(data, 0, 0);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, mime: "image/png" };
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

/** A Mero Models scene file, with fresh ids so it can be imported into any scene, even its own. */
export function importSceneFile(data: unknown, takenNames: string[]): Imported {
  const file = data as Partial<SceneFile>;
  if (file?.format !== "mero-models" || !Array.isArray(file.objects)) {
    throw new Error("That JSON file is not a Mero Models scene.");
  }
  const remap = new Map(file.objects.map((o) => [o.id, newId()]));
  const texRemap = new Map((file.textures ?? []).map((t) => [t.id, newId()]));
  const taken = takenNames.slice();
  const objects: SceneObject[] = [];
  for (const o of file.objects) {
    if (!OBJECT_KINDS.includes(o.kind as (typeof OBJECT_KINDS)[number])) continue;
    const name = uniqueName(o.name, taken);
    taken.push(name);
    const material = { ...defaultMaterial(o.kind), ...o.material };
    for (const slot of MAP_SLOTS) material[slot.key] = texRemap.get(material[slot.key]) ?? "";
    objects.push({ ...o, material, id: remap.get(o.id)!, name, parent: remap.get(o.parent) ?? "", created_at: 0, updated_at: 0, created_by: "" });
  }
  const meshes = Object.entries(file.meshes ?? {})
    .filter(([id]) => remap.has(id))
    .map(([id, m]) => ({ id: remap.get(id)!, shape: m.cage ? decodeMesh(fromBase64(m.cage)) : makeShape(m.positions, m.indices, m.uvs) }));
  const textures: ImportedTexture[] = (file.textures ?? []).map((t) => ({
    id: texRemap.get(t.id)!,
    name: t.name,
    width: t.width,
    height: t.height,
    mime: t.mime,
    colorSpace: t.colorSpace,
    bytes: fromBase64(t.data),
  }));
  // Parents before children, so the batch reads sensibly in order.
  const byId = new Map(objects.map((o) => [o.id, o]));
  const ordered: SceneObject[] = [];
  const placed = new Set<string>();
  const place = (o: SceneObject) => {
    if (placed.has(o.id)) return;
    placed.add(o.id);
    const parent = byId.get(o.parent);
    if (parent) place(parent);
    ordered.push(o);
  };
  objects.forEach(place);
  return { objects: ordered, meshes, textures, notes: [] };
}

// ── Export ──────────────────────────────────────────────────────────────────

export type ExportFormat = "glb" | "obj" | "stl" | "json";

export interface ExportTextures {
  cache: TextureCache;
  refs: Map<string, TextureRef>;
}

/** Load every texture the visible objects use, and a synchronous lookup over them. */
async function preload(objects: Map<string, SceneObject>, textures: ExportTextures | undefined): Promise<TextureLookup | undefined> {
  if (!textures) return undefined;
  const ready = new Map<string, THREE.Texture>();
  const jobs: Promise<void>[] = [];
  for (const o of objects.values()) {
    for (const slot of MAP_SLOTS) {
      const id = o.material[slot.key];
      const ref = id ? textures.refs.get(id) : undefined;
      const key = `${id}:${slot.colorSpace}`;
      if (!ref || ready.has(key)) continue;
      jobs.push(
        textures.cache
          .load(ref, slot.colorSpace)
          .then((t) => void ready.set(key, t))
          .catch(() => {}),
      );
    }
  }
  await Promise.all(jobs);
  return (id, colorSpace) => ready.get(`${id}:${colorSpace}`) ?? null;
}

export async function exportScene(
  format: ExportFormat,
  objects: Map<string, SceneObject>,
  meshes: Map<string, StoredMesh>,
  name: string,
  textures?: ExportTextures,
): Promise<void> {
  const base = (name || "scene").replace(/[^\w.-]+/g, "_");
  if (format === "json") {
    const used = new Set<string>();
    for (const o of objects.values()) for (const slot of MAP_SLOTS) if (o.material[slot.key]) used.add(o.material[slot.key]);
    const embedded: NonNullable<SceneFile["textures"]> = [];
    for (const id of used) {
      const ref = textures?.refs.get(id);
      if (!ref || !textures) continue;
      const bytes = new Uint8Array(await textures.cache.blobs.get(ref.blob_id));
      embedded.push({ id, name: ref.name, width: ref.width, height: ref.height, mime: ref.mime, colorSpace: ref.color_space as ColorSpaceName, data: toBase64(bytes) });
    }
    const file: SceneFile = {
      format: "mero-models",
      version: 2,
      objects: [...objects.values()],
      meshes: Object.fromEntries(
        [...meshes].map(([id, m]) => [
          id,
          {
            positions: Array.from(m.shape.positions),
            indices: Array.from(m.shape.indices),
            ...(m.shape.uvs ? { uvs: Array.from(m.shape.uvs) } : {}),
            ...(m.shape.poly ? { cage: toBase64(encodeMesh(m.shape)) } : {}),
          },
        ]),
      ),
      textures: embedded,
    };
    download(new Blob([JSON.stringify(file)], { type: "application/json" }), `${base}.json`);
    return;
  }
  const lookup = format === "glb" ? await preload(objects, textures) : undefined;
  const scene = buildScene(meshes, childrenIndex(objects), true, lookup);
  scene.updateMatrixWorld(true);
  if (format === "glb") {
    const result = await new GLTFExporter().parseAsync(scene, { binary: true });
    download(new Blob([result as ArrayBuffer], { type: "model/gltf-binary" }), `${base}.glb`);
  } else if (format === "obj") {
    download(new Blob([toObj(scene, objects, meshes)], { type: "text/plain" }), `${base}.obj`);
  } else {
    const data = new STLExporter().parse(scene, { binary: true }) as unknown as DataView;
    download(new Blob([data.buffer as ArrayBuffer], { type: "model/stl" }), `${base}.stl`);
  }
}

/**
 * Wavefront OBJ of everything visible, in world space. A mesh with a cage
 * (modifiers applied) is written as its quads and n-gons — what a game
 * pipeline wants to receive — with a UV per corner; a triangle mesh as its
 * triangles. Normals are left to the importer, as most DCCs recompute them.
 */
function toObj(scene: THREE.Scene, objects: Map<string, SceneObject>, meshes: Map<string, StoredMesh>): string {
  const out: string[] = ["# Mero Models"];
  let vBase = 1;
  let tBase = 1;
  const v = new THREE.Vector3();
  scene.traverseVisible((node) => {
    const mesh = node as THREE.Mesh;
    const id = mesh.userData.id as string | undefined;
    if (!mesh.isMesh || !id || mesh.userData.helper) return;
    const o = objects.get(id);
    if (!o) return;
    const shape = meshes.get(id)?.shape ?? (() => {
      const p = primitivePoly(o.kind, o.segments);
      return p ? shapeFromPoly(p) : undefined;
    })();
    if (!shape) return;
    mesh.updateWorldMatrix(true, false);
    // A mirroring transform turns faces inside out; write them the other way round.
    const order = <T,>(f: T[]): T[] => (mesh.matrixWorld.determinant() < 0 ? [f[0]!, ...f.slice(1).reverse()] : f);
    out.push(`o ${o.name.replace(/\s+/g, "_")}`);
    if (shape.poly) {
      const p = evaluate(shape.poly).poly;
      for (let i = 0; i < p.positions.length; i += 3) {
        v.set(p.positions[i]!, p.positions[i + 1]!, p.positions[i + 2]!).applyMatrix4(mesh.matrixWorld);
        out.push(`v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}`);
      }
      let corner = 0;
      if (p.uvs) for (const uv of p.uvs) for (let k = 0; k < uv.length; k += 2) out.push(`vt ${uv[k]!.toFixed(6)} ${uv[k + 1]!.toFixed(6)}`);
      for (const face of p.faces) {
        out.push(`f ${order(face.map((x) => (p.uvs ? `${x + vBase}/${tBase + corner++}` : `${x + vBase}`))).join(" ")}`);
      }
      vBase += p.positions.length / 3;
      tBase += corner;
    } else {
      const n = shape.positions.length / 3;
      for (let i = 0; i < n; i += 1) {
        v.set(shape.positions[i * 3]!, shape.positions[i * 3 + 1]!, shape.positions[i * 3 + 2]!).applyMatrix4(mesh.matrixWorld);
        out.push(`v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}`);
      }
      if (shape.uvs) for (let i = 0; i < n; i += 1) out.push(`vt ${shape.uvs[i * 2]!.toFixed(6)} ${shape.uvs[i * 2 + 1]!.toFixed(6)}`);
      for (let t = 0; t < shape.indices.length; t += 3) {
        const f = [shape.indices[t]!, shape.indices[t + 1]!, shape.indices[t + 2]!];
        out.push(`f ${order(f.map((x) => (shape.uvs ? `${x + vBase}/${x + tBase}` : `${x + vBase}`))).join(" ")}`);
      }
      vBase += n;
      if (shape.uvs) tBase += n;
    }
  });
  return `${out.join("\n")}\n`;
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
