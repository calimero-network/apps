import { bake } from "./bake";
import { shapeOf } from "./commands";
import { cloneObject, isSolid, newId, type SceneObject } from "./model";
import { evaluate } from "./modifiers";
import { withModifiers, type Poly } from "./poly";
import { transformPoly } from "./polyops";
import { encodePng } from "./png";
import { polyOf, shapeFromPoly } from "./polymesh";
import { emptyChange, useEditor } from "./store";
import type { SceneSync } from "./sync";
import { generate, type SmartMaterial } from "./texgen";
import { worldMatrix } from "./transform";
import { smartProject } from "./uv";

/**
 * Texture objects with a smart material, end to end: make sure the mesh has
 * a clean UV layout, bake its maps, generate the three textures, upload them
 * as the scene's texture assets (a regeneration is a new version of the same
 * assets) and plug them into the object's material — one undo step each.
 */

export type NormalSource = { kind: "none" } | { kind: "modifiers" } | { kind: "object"; id: string };

export interface TextureJob {
  ids: string[];
  material: (o: SceneObject) => SmartMaterial;
  size: number;
  aoSamples: number;
  normals: NormalSource;
}

const SUFFIX = { base: "base colour", orm: "occlusion·rough·metal", normal: "normal" } as const;

/** The colour paint layers use: the object's, or — once it has been textured (and its colour set to white) — the one recorded on its base texture. */
export function paintColour(o: SceneObject): string {
  if (o.material.color.toLowerCase() !== "#ffffff") return o.material.color;
  const ref = useEditor.getState().textures.get(o.material.base_color_map);
  return /· (#[0-9a-f]{6})$/i.exec(ref?.name ?? "")?.[1] ?? "#c9ccd3";
}

function extent(p: Poly): number {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.positions.length; i += 1) {
    mn[i % 3] = Math.min(mn[i % 3]!, p.positions[i]!);
    mx[i % 3] = Math.max(mx[i % 3]!, p.positions[i]!);
  }
  return Math.hypot(mx[0]! - mn[0]!, mx[1]! - mn[1]!, mx[2]! - mn[2]!) || 1;
}

export async function textureObjects(job: TextureJob, sync: SceneSync, onProgress: (text: string, done: number) => void): Promise<number> {
  let done = 0;
  for (const [index, id] of job.ids.entries()) {
    const s = useEditor.getState();
    const o = s.objects.get(id);
    if (!o || !isSolid(o.kind)) continue;
    if (s.lockedByOther(id)) {
      s.notify(`${o.name} is checked out by someone else; skipped.`, true);
      continue;
    }
    const shape = shapeOf(o);
    if (!shape) {
      s.notify(`${o.name} is still downloading; skipped.`, true);
      continue;
    }
    const step = (text: string, f: number) => onProgress(`${o.name}: ${text}`, (index + f) / job.ids.length);
    const material = job.material(o);
    let poly = polyOf(shape);
    let meshChanged = o.kind !== "mesh";
    let laidOut = false;
    if (!poly.uvs) {
      poly = smartProject(poly, null, 66, 0.01);
      meshChanged = laidOut = true;
    }
    // What to bake normals from, and what the textures then sit on.
    let low = poly;
    let high: Poly | null = null;
    if (job.normals.kind === "modifiers" && poly.modifiers.some((m) => m.type === "subdivision" && m.on)) {
      low = withModifiers(poly, poly.modifiers.filter((m) => m.type !== "subdivision"));
      high = poly;
      // The game mesh is the light one; the detail lives in the normal map now.
      poly = withModifiers(poly, poly.modifiers.map((m) => (m.type === "subdivision" ? { ...m, on: false } : m)));
      meshChanged = true;
    } else if (job.normals.kind === "object" && job.normals.id !== id) {
      const other = s.objects.get(job.normals.id);
      const otherShape = other ? shapeOf(other) : null;
      if (other && otherShape) {
        const into = worldMatrix(id, s.objects).invert().multiply(worldMatrix(other.id, s.objects));
        high = transformPoly(withModifiers(evaluate(polyOf(otherShape)).poly, []), into.elements);
      }
    }
    const size = extent(low);
    const options = { size: job.size, aoSamples: job.aoSamples, aoDistance: 0.25, edgeWidth: Math.max(0.004, size * 0.012), high, cageDistance: 0.06 };
    let maps = await bake(low, options, (stage, f) => step(stage, f * 0.85));
    if (maps.overlap > 0.02 && !laidOut) {
      // Overlapping UVs would share one texel between two surfaces: lay it out afresh first.
      step("UVs overlap — laying them out again", 0);
      poly = smartProject(poly, null, 66, 0.01);
      low = high && low !== poly ? smartProject(low, null, 66, 0.01) : poly;
      meshChanged = laidOut = true;
      maps = await bake(low, options, (stage, f) => step(stage, f * 0.85));
    }
    const colour = paintColour(o);
    const tex = await generate(maps, material, colour, 1, (f) => step("Generating textures", 0.85 + f * 0.05));
    const existing = (slot: "base_color_map" | "orm_map" | "normal_map") => {
      const ref = s.textures.get(o.material[slot]);
      return ref && ref.name.startsWith(`${o.name} · `) ? ref.id : newId();
    };
    const ids = { base: existing("base_color_map"), orm: existing("orm_map"), normal: existing("normal_map") };
    const uploads: [keyof typeof ids, Uint8Array, "srgb" | "linear", string][] = [
      ["base", tex.baseColor, "srgb", `${o.name} · ${SUFFIX.base} · ${colour.toLowerCase()}`],
      ["orm", tex.orm, "linear", `${o.name} · ${SUFFIX.orm}`],
      ["normal", tex.normal, "linear", `${o.name} · ${SUFFIX.normal}`],
    ];
    for (const [i, [key, pixels, colorSpace, name]] of uploads.entries()) {
      step(`Uploading ${SUFFIX[key]}`, 0.9 + i * 0.03);
      await sync.putTexture(
        { id: ids[key], name: name.slice(0, 80), width: tex.size, height: tex.size, mime: "image/png", color_space: colorSpace, message: `Generated: ${material.name}` },
        encodePng(pixels, tex.size, tex.size),
      );
    }
    const now = useEditor.getState();
    const current = now.objects.get(id);
    if (!current) continue;
    const change = emptyChange();
    change.puts.push({
      ...cloneObject(current),
      kind: "mesh",
      material: {
        ...current.material,
        base_color_map: ids.base,
        orm_map: ids.orm,
        normal_map: ids.normal,
        normal_scale: 1,
        // The textures carry colour, roughness and metalness; the factors multiply them.
        color: "#ffffff",
        roughness: 1,
        metalness: 1,
      },
    });
    if (meshChanged) change.meshes.push({ id, shape: shapeFromPoly(poly), message: laidOut ? "Laid out for texturing" : "Baked subdivision into normals" });
    now.commit(change, `Texture ${o.name}: ${material.name}`);
    done += 1;
  }
  onProgress("Done", 1);
  return done;
}
