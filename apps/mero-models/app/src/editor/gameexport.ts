import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { zipSync } from "fflate";
import type { TextureRef } from "../generated/MeroModelsClient";
import { standardMaterial, type TextureLookup } from "./build";
import { boxHull, convexHull } from "./collision";
import { writeFbx, type FbxMesh } from "./fbx";
import { geometryFromShape, type MeshShape } from "./geometry";
import { simplify } from "./lod";
import { childrenIndex, isSolid, type SceneObject } from "./model";
import type { TextureCache } from "./textures";
import { worldMatrix } from "./transform";
import { validateAsset, type AssetPart, type Budget, type Check } from "./validate";

/**
 * Game export: the selection as an engine expects to receive it.
 *
 * Every mesh goes out with its levels of detail and a collision mesh, named
 * by the target engine's import conventions so they are recognised without
 * setup — Unreal's `UCX_` colliders, Unity's `_LOD0…` groups, Godot's
 * `-colonly` — in FBX (zipped with its textures and a report) or GLB.
 */

export type Engine = "unreal" | "unity" | "godot" | "generic";
export type Collision = "none" | "hull" | "box";

export interface GameExportOptions {
  engine: Engine;
  format: "fbx" | "glb";
  /** Extra levels of detail after LOD 0, each `lodRatio` of the one before. */
  lods: number;
  lodRatio: number;
  collision: Collision;
}

export const ENGINES: { key: Engine; label: string }[] = [
  { key: "unreal", label: "Unreal Engine" },
  { key: "unity", label: "Unity" },
  { key: "godot", label: "Godot" },
  { key: "generic", label: "Generic" },
];

const clean = (s: string) => s.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "Mesh";

/** What each piece is called, by engine. */
export function names(engine: Engine, objectName: string) {
  const base = clean(objectName);
  switch (engine) {
    case "unreal":
      return {
        lod: (k: number, any: boolean) => (k === 0 || !any ? `SM_${base}` : `SM_${base}_LOD${k}`),
        collision: `UCX_SM_${base}_00`,
        material: `M_${base}`,
        texture: (slot: string) => `T_${base}_${slot}`,
      };
    case "unity":
      return {
        lod: (k: number, any: boolean) => (any ? `${base}_LOD${k}` : base),
        collision: `${base}_Collider`,
        material: `${base}_Mat`,
        texture: (slot: string) => `${base}_${slot}`,
      };
    case "godot":
      return {
        lod: (k: number) => (k === 0 ? base : `${base}_LOD${k}`),
        collision: `${base}-colonly`,
        material: `${base}_mat`,
        texture: (slot: string) => `${base}_${slot.toLowerCase()}`,
      };
    default:
      return {
        lod: (k: number) => (k === 0 ? base : `${base}_LOD${k}`),
        collision: `${base}_collision`,
        material: `${base}_material`,
        texture: (slot: string) => `${base}_${slot}`,
      };
  }
}

export interface PlannedMesh {
  object: SceneObject;
  /** LOD 0 first. */
  lods: { name: string; shape: MeshShape }[];
  collision: { name: string; shape: MeshShape } | null;
  world: THREE.Matrix4;
}

/** The solid objects an export covers: the selection with everything under it, or the whole scene. */
export function exportObjects(selection: string[], objects: Map<string, SceneObject>): SceneObject[] {
  const kids = childrenIndex(objects);
  const out = new Map<string, SceneObject>();
  const walk = (o: SceneObject) => {
    if (!o.visible) return;
    if (isSolid(o.kind)) out.set(o.id, o);
    for (const c of kids.get(o.id) ?? []) walk(c);
  };
  if (selection.length) for (const id of selection) objects.get(id) && walk(objects.get(id)!);
  else for (const o of kids.get("") ?? []) walk(o);
  return [...out.values()];
}

/** LODs and colliders for each object. */
export function planExport(
  objects: SceneObject[],
  all: Map<string, SceneObject>,
  shapeOf: (o: SceneObject) => MeshShape | null,
  opts: GameExportOptions,
): PlannedMesh[] {
  const plan: PlannedMesh[] = [];
  for (const o of objects) {
    const shape = shapeOf(o);
    if (!shape || !shape.indices.length) continue;
    const n = names(opts.engine, o.name);
    const lods = [{ name: n.lod(0, opts.lods > 0), shape }];
    let prev = shape;
    for (let k = 1; k <= opts.lods; k += 1) {
      const next = simplify(prev, opts.lodRatio).shape;
      // A level that saves under a tenth is not worth a level: the seams and hard edges left cannot go without tearing.
      if (next.indices.length > prev.indices.length * 0.9) break;
      lods.push({ name: n.lod(k, true), shape: next });
      prev = next;
    }
    const hull = opts.collision === "hull" ? convexHull(shape) ?? boxHull(shape) : opts.collision === "box" ? boxHull(shape) : null;
    plan.push({ object: o, lods, collision: hull ? { name: n.collision, shape: hull } : null, world: worldMatrix(o.id, all) });
  }
  return plan;
}

/** The asset checks for a plan. */
export function checkPlan(plan: PlannedMesh[], textures: TextureRef[], budget: Budget): Check[] {
  const parts: AssetPart[] = plan.map((p) => {
    const s = new THREE.Vector3();
    p.world.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    if (p.world.determinant() < 0) s.x = -s.x;
    const shape = p.lods[0]!.shape;
    return { object: p.object, shape, ngons: shape.poly?.faces.filter((f) => f.length > 4).length ?? 0, worldScale: [s.x, s.y, s.z] };
  });
  return validateAsset(parts, textures, budget);
}

/** The textures a plan's materials use. */
export function planTextures(plan: PlannedMesh[], refs: Map<string, TextureRef>): TextureRef[] {
  const out = new Map<string, TextureRef>();
  for (const p of plan) {
    const m = p.object.material;
    for (const id of [m.base_color_map, m.normal_map, m.orm_map, m.emissive_map]) {
      const ref = id ? refs.get(id) : undefined;
      if (ref) out.set(ref.id, ref);
    }
  }
  return [...out.values()];
}

function decompose(m: THREE.Matrix4): Pick<FbxMesh, "translation" | "rotation" | "scale"> {
  const t = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(t, q, s);
  // FBX's default rotation order applies X, then Y, then Z about fixed axes: three's 'ZYX'.
  const e = new THREE.Euler().setFromQuaternion(q, "ZYX");
  const deg = THREE.MathUtils.radToDeg;
  return { translation: [t.x, t.y, t.z], rotation: [deg(e.x), deg(e.y), deg(e.z)], scale: [s.x, s.y, s.z] };
}

const extension = (mime: string) => (mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png");

function report(plan: PlannedMesh[], checks: Check[], opts: GameExportOptions): string {
  const lines = [`Mero Models game export · ${ENGINES.find((e) => e.key === opts.engine)!.label} · ${opts.format.toUpperCase()}`, ""];
  for (const p of plan) {
    lines.push(`${p.object.name}`);
    for (const l of p.lods) lines.push(`  ${l.name}: ${(l.shape.indices.length / 3).toLocaleString()} triangles`);
    if (p.collision) lines.push(`  ${p.collision.name}: ${p.collision.shape.positions.length / 3} vertices`);
  }
  lines.push("", "Checks:");
  for (const c of checks) lines.push(`  [${c.severity}] ${c.object ? `${c.object}: ` : ""}${c.text}`);
  return `${lines.join("\n")}\n`;
}

/** Build the file for a plan: an FBX zip with textures and report, or a GLB. */
export async function buildGameExport(
  plan: PlannedMesh[],
  checks: Check[],
  opts: GameExportOptions,
  assetName: string,
  textures: { refs: Map<string, TextureRef>; cache: TextureCache } | null,
): Promise<{ filename: string; data: Uint8Array; mime: string }> {
  const base = clean(assetName);
  if (opts.format === "fbx") {
    const files: Record<string, Uint8Array> = {};
    const meshes: FbxMesh[] = [];
    for (const p of plan) {
      const n = names(opts.engine, p.object.name);
      const m = p.object.material;
      const fileFor = async (id: string, slot: string) => {
        const ref = id ? textures?.refs.get(id) : undefined;
        if (!ref || !textures) return undefined;
        const file = `${n.texture(slot)}.${extension(ref.mime)}`;
        files[file] ??= new Uint8Array(await textures.cache.blobs.get(ref.blob_id));
        return file;
      };
      const baseColorFile = await fileFor(m.base_color_map, "BaseColor");
      const normalFile = await fileFor(m.normal_map, "Normal");
      await fileFor(m.orm_map, "ORM");
      const c = new THREE.Color(m.color);
      const material = { name: n.material, color: [c.r, c.g, c.b] as [number, number, number], baseColorFile, normalFile };
      const pose = decompose(p.world);
      for (const l of p.lods) {
        const g = geometryFromShape(l.shape).toNonIndexed();
        meshes.push({
          name: l.name,
          positions: g.getAttribute("position").array as Float32Array,
          normals: g.getAttribute("normal").array as Float32Array,
          uvs: (g.getAttribute("uv")?.array as Float32Array | undefined) ?? null,
          ...pose,
          material,
        });
        g.dispose();
      }
      if (p.collision) {
        const g = geometryFromShape(p.collision.shape).toNonIndexed();
        meshes.push({
          name: p.collision.name,
          positions: g.getAttribute("position").array as Float32Array,
          normals: g.getAttribute("normal").array as Float32Array,
          ...pose,
        });
        g.dispose();
      }
    }
    files[`${base}.fbx`] = writeFbx(meshes);
    files[`${base}_report.txt`] = new TextEncoder().encode(report(plan, checks, opts));
    return { filename: `${base}.zip`, data: zipSync(files, { level: 6 }), mime: "application/zip" };
  }
  // GLB: the same pieces as nodes, textures embedded.
  const loaded = new Map<string, THREE.Texture>();
  if (textures) {
    for (const p of plan) {
      const m = p.object.material;
      for (const [id, cs] of [[m.base_color_map, "srgb"], [m.normal_map, "linear"], [m.orm_map, "linear"], [m.emissive_map, "srgb"]] as const) {
        const ref = id ? textures.refs.get(id) : undefined;
        if (ref && !loaded.has(`${id}:${cs}`)) loaded.set(`${id}:${cs}`, await textures.cache.load(ref, cs));
      }
    }
  }
  const scene = new THREE.Scene();
  for (const p of plan) {
    const lookup: TextureLookup = (id, cs) => loaded.get(`${id}:${cs}`) ?? null;
    const material = standardMaterial(p.object, lookup);
    material.name = names(opts.engine, p.object.name).material;
    const add = (name: string, shape: MeshShape, mat: THREE.Material) => {
      const mesh = new THREE.Mesh(geometryFromShape(shape), mat);
      mesh.name = name;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(p.world);
      scene.add(mesh);
    };
    for (const l of p.lods) add(l.name, l.shape, material);
    if (p.collision) {
      const collider = new THREE.MeshBasicMaterial({ color: "#ff00ff", wireframe: true });
      collider.name = "Collision";
      add(p.collision.name, p.collision.shape, collider);
    }
  }
  scene.updateMatrixWorld(true);
  const glb = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
  return { filename: `${base}.glb`, data: new Uint8Array(glb), mime: "model/gltf-binary" };
}
