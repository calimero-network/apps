import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { buildScene } from "./build";
import { decimateToFit, shapeCenter, shapeFromGeometry, transformShape, vertexCount, type MeshShape } from "./geometry";
import {
  MAX_OBJECTS,
  OBJECT_KINDS,
  childrenIndex,
  defaultMaterial,
  makeObject,
  newId,
  uniqueName,
  vec,
  type SceneObject,
} from "./model";
import type { StoredMesh } from "./store";

/** What an import adds: objects (parents first) and the meshes they draw with. */
export interface Imported {
  objects: SceneObject[];
  meshes: { id: string; shape: MeshShape }[];
  /** Things worth telling the person: pieces decimated, a model rescaled. */
  notes: string[];
}

export const IMPORT_ACCEPT = ".obj,.stl,.glb,.gltf,.json";

/** The native scene file: what `exportScene` writes and `importFile` reads back. */
interface SceneFile {
  format: "mero-models";
  version: 1;
  objects: SceneObject[];
  meshes: Record<string, MeshShape>;
}

export async function importFile(file: File, takenNames: string[]): Promise<Imported> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const stem = file.name.replace(/\.[^.]+$/, "") || "Import";
  if (ext === "json") return importSceneFile(JSON.parse(await file.text()), takenNames);
  let root: THREE.Object3D;
  if (ext === "obj") {
    root = new OBJLoader().parse(await file.text());
  } else if (ext === "stl") {
    const geometry = new STLLoader().parse(await file.arrayBuffer());
    root = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  } else if (ext === "glb" || ext === "gltf") {
    const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), "");
    root = gltf.scene;
  } else {
    throw new Error(`Cannot import .${ext} files — use OBJ, STL, glTF/GLB or a Mero Models scene (.json).`);
  }
  return fromObject3D(root, stem, takenNames);
}

/**
 * Every mesh under `root` as a mesh object inside one new empty named after
 * the file. Each piece's world transform is baked into its vertices and its
 * origin moved to its centre, so the pieces arrive where the file put them and
 * each can be moved on its own.
 */
export function fromObject3D(root: THREE.Object3D, stem: string, takenNames: string[]): Imported {
  root.updateMatrixWorld(true);
  const notes: string[] = [];
  const pieces: { name: string; shape: MeshShape; color: string; metalness: number; roughness: number }[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    let shape = shapeFromGeometry(mesh.geometry, mesh.matrixWorld);
    if (!shape.indices.length) return;
    const before = vertexCount(shape);
    shape = decimateToFit(shape);
    if (vertexCount(shape) < before) {
      notes.push(`${mesh.name || "A piece"} was simplified from ${before.toLocaleString()} to ${vertexCount(shape).toLocaleString()} vertices to fit.`);
    }
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
      | (THREE.Material & { color?: THREE.Color; metalness?: number; roughness?: number })
      | undefined;
    pieces.push({
      name: mesh.name || child.parent?.name || stem,
      shape,
      color: material?.color ? `#${material.color.getHexString()}` : defaultMaterial("mesh").color,
      metalness: material?.metalness ?? 0,
      roughness: material?.roughness ?? 0.55,
    });
  });
  if (!pieces.length) throw new Error("No meshes found in that file.");
  if (pieces.length + 1 > MAX_OBJECTS) throw new Error(`That file has ${pieces.length} meshes; a scene holds at most ${MAX_OBJECTS} objects.`);

  // Models arrive in every unit there is. One far too big or too small to see
  // is scaled to a couple of units across and said so; anything sensible is
  // left at its own size.
  const bounds = new THREE.Box3();
  for (const p of pieces) {
    for (let i = 0; i < p.shape.positions.length; i += 3) {
      bounds.expandByPoint(new THREE.Vector3(p.shape.positions[i], p.shape.positions[i + 1], p.shape.positions[i + 2]));
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
  // Centre it on the origin, standing on the ground.
  const placement = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));

  const taken = takenNames.slice();
  const group = makeObject("group", taken);
  group.name = uniqueName(stem, taken);
  taken.push(group.name);
  const out: Imported = { objects: [group], meshes: [], notes };
  for (const p of pieces) {
    const placed = transformShape(p.shape, placement);
    const c = shapeCenter(placed);
    const local = transformShape(placed, new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    const obj = makeObject("mesh", taken);
    obj.name = uniqueName(p.name, taken);
    taken.push(obj.name);
    obj.parent = group.id;
    obj.position = vec(c.x, c.y, c.z);
    obj.material = { ...obj.material, color: p.color, metalness: clamp01(p.metalness), roughness: clamp01(p.roughness) };
    out.objects.push(obj);
    out.meshes.push({ id: obj.id, shape: local });
  }
  return out;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** A Mero Models scene file, with fresh ids so it can be imported into any scene, even its own. */
export function importSceneFile(data: unknown, takenNames: string[]): Imported {
  const file = data as Partial<SceneFile>;
  if (file?.format !== "mero-models" || !Array.isArray(file.objects)) {
    throw new Error("That JSON file is not a Mero Models scene.");
  }
  const remap = new Map(file.objects.map((o) => [o.id, newId()]));
  const taken = takenNames.slice();
  const objects: SceneObject[] = [];
  for (const o of file.objects) {
    if (!OBJECT_KINDS.includes(o.kind as (typeof OBJECT_KINDS)[number])) continue;
    const name = uniqueName(o.name, taken);
    taken.push(name);
    objects.push({ ...o, id: remap.get(o.id)!, name, parent: remap.get(o.parent) ?? "", created_at: 0, updated_at: 0, created_by: "" });
  }
  const meshes = Object.entries(file.meshes ?? {})
    .filter(([id]) => remap.has(id))
    .map(([id, shape]) => ({ id: remap.get(id)!, shape: { positions: shape.positions, indices: shape.indices } }));
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
  return { objects: ordered, meshes, notes: [] };
}

// ── Export ──────────────────────────────────────────────────────────────────

export type ExportFormat = "glb" | "obj" | "stl" | "json";

export async function exportScene(
  format: ExportFormat,
  objects: Map<string, SceneObject>,
  meshes: Map<string, StoredMesh>,
  name: string,
): Promise<void> {
  const base = (name || "scene").replace(/[^\w.-]+/g, "_");
  if (format === "json") {
    const file: SceneFile = {
      format: "mero-models",
      version: 1,
      objects: [...objects.values()],
      meshes: Object.fromEntries([...meshes].map(([id, m]) => [id, m.shape])),
    };
    download(new Blob([JSON.stringify(file)], { type: "application/json" }), `${base}.json`);
    return;
  }
  const scene = buildScene(meshes, childrenIndex(objects));
  scene.updateMatrixWorld(true);
  if (format === "glb") {
    const result = await new GLTFExporter().parseAsync(scene, { binary: true });
    download(new Blob([result as ArrayBuffer], { type: "model/gltf-binary" }), `${base}.glb`);
  } else if (format === "obj") {
    download(new Blob([new OBJExporter().parse(scene)], { type: "text/plain" }), `${base}.obj`);
  } else {
    const data = new STLExporter().parse(scene, { binary: true }) as unknown as DataView;
    download(new Blob([data.buffer as ArrayBuffer], { type: "model/stl" }), `${base}.stl`);
  }
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
