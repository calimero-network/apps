import type {
  Environment,
  Material,
  MeshData,
  SceneObject,
  Vec3,
} from "../generated/MeroModelsClient";

export type { Environment, Material, MeshData, SceneObject, Vec3 };

/**
 * Every kind the contract accepts (`OBJECT_KINDS` in logic/src/lib.rs). The
 * contract refuses anything else, so this list is the frontend's copy of a
 * rule, kept honest by `model.test.ts` reading the contract source.
 */
export const OBJECT_KINDS = [
  "cube",
  "sphere",
  "icosphere",
  "cylinder",
  "cone",
  "torus",
  "plane",
  "capsule",
  "mesh",
  "group",
  "point_light",
  "spot_light",
  "directional_light",
] as const;

export type ObjectKind = (typeof OBJECT_KINDS)[number];

export const PRIMITIVES: { kind: ObjectKind; label: string }[] = [
  { kind: "cube", label: "Cube" },
  { kind: "sphere", label: "UV Sphere" },
  { kind: "icosphere", label: "Ico Sphere" },
  { kind: "cylinder", label: "Cylinder" },
  { kind: "cone", label: "Cone" },
  { kind: "torus", label: "Torus" },
  { kind: "plane", label: "Plane" },
  { kind: "capsule", label: "Capsule" },
];

export const LIGHTS: { kind: ObjectKind; label: string }[] = [
  { kind: "point_light", label: "Point light" },
  { kind: "spot_light", label: "Spot light" },
  { kind: "directional_light", label: "Sun" },
];

/** Limits mirrored from the contract, so the UI refuses before the node does. */
export const MAX_BATCH = 200;
export const MAX_OBJECTS = 2_000;
export const MAX_VERTICES = 30_000;
export const MAX_TRIANGLES = 60_000;

export function isLight(kind: string): boolean {
  return kind === "point_light" || kind === "spot_light" || kind === "directional_light";
}

/** Kinds whose `segments` field changes the shape. */
export function isCurved(kind: string): boolean {
  return ["sphere", "icosphere", "cylinder", "cone", "torus", "capsule"].includes(kind);
}

/** Kinds that draw a surface and so can become an editable mesh. */
export function isSolid(kind: string): boolean {
  return kind !== "group" && !isLight(kind);
}

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export function newId(): string {
  // `crypto.randomUUID` is only defined in a secure context, and a node on a
  // LAN address over plain http is not one.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function defaultMaterial(kind: string): Material {
  if (isLight(kind)) {
    return {
      color: "#fff4e0",
      metalness: 0,
      roughness: 1,
      opacity: 1,
      emissive: "#000000",
      wireframe: false,
      flat_shading: false,
    };
  }
  return {
    color: "#c9ccd3",
    metalness: 0,
    roughness: 0.55,
    opacity: 1,
    emissive: "#000000",
    wireframe: false,
    flat_shading: kind === "cube" || kind === "plane",
  };
}

const LABELS: Record<string, string> = {
  cube: "Cube",
  sphere: "Sphere",
  icosphere: "Icosphere",
  cylinder: "Cylinder",
  cone: "Cone",
  torus: "Torus",
  plane: "Plane",
  capsule: "Capsule",
  mesh: "Mesh",
  group: "Empty",
  point_light: "Point",
  spot_light: "Spot",
  directional_light: "Sun",
};

export function kindLabel(kind: string): string {
  return LABELS[kind] ?? kind;
}

/** `Cube`, `Cube.001`, `Cube.002`… — the next free name with this stem, Blender-style. */
export function uniqueName(stem: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  const base = stem.replace(/\.\d{3}$/, "");
  if (!names.has(base)) return base;
  for (let i = 1; i < 10_000; i += 1) {
    const candidate = `${base}.${String(i).padStart(3, "0")}`;
    if (!names.has(candidate)) return candidate;
  }
  return `${base}.${Date.now()}`;
}

/** A fresh object of `kind`, sitting on the ground at `at`. */
export function makeObject(
  kind: ObjectKind,
  takenNames: Iterable<string>,
  at: Vec3 = vec(),
): SceneObject {
  const lift = isSolid(kind) && kind !== "plane" && kind !== "mesh" ? 0.5 : 0;
  const position =
    kind === "directional_light"
      ? vec(at.x + 4, 6, at.z + 3)
      : isLight(kind)
        ? vec(at.x, at.y + 3, at.z)
        : vec(at.x, at.y + lift, at.z);
  // A sun or spot points down its local -Y; tilt it so it lights the scene at
  // an angle instead of straight down.
  const rotation =
    kind === "directional_light" ? vec(-0.6, 0, 0.5) : kind === "spot_light" ? vec(0, 0, 0) : vec();
  return {
    id: newId(),
    name: uniqueName(kindLabel(kind), takenNames),
    kind,
    parent: "",
    position,
    rotation,
    scale: vec(1, 1, 1),
    visible: true,
    material: defaultMaterial(kind),
    segments: kind === "icosphere" ? 3 : 32,
    intensity: kind === "directional_light" ? 2.5 : kind === "spot_light" ? 40 : isLight(kind) ? 25 : 0,
    created_by: "",
    created_at: 0,
    updated_at: 0,
  };
}

export function defaultEnvironment(): Environment {
  return {
    name: "",
    background: "#24262b",
    ambient_color: "#ffffff",
    ambient_intensity: 0.35,
    updated_at: 0,
  };
}

export function cloneObject(o: SceneObject): SceneObject {
  return {
    ...o,
    position: { ...o.position },
    rotation: { ...o.rotation },
    scale: { ...o.scale },
    material: { ...o.material },
  };
}

/** Equal in everything a person can see or edit — ignores the contract's stamps. */
export function sameObject(a: SceneObject, b: SceneObject): boolean {
  const v = (p: Vec3, q: Vec3) => p.x === q.x && p.y === q.y && p.z === q.z;
  const m = a.material;
  const n = b.material;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.kind === b.kind &&
    a.parent === b.parent &&
    a.visible === b.visible &&
    a.segments === b.segments &&
    a.intensity === b.intensity &&
    v(a.position, b.position) &&
    v(a.rotation, b.rotation) &&
    v(a.scale, b.scale) &&
    m.color === n.color &&
    m.metalness === n.metalness &&
    m.roughness === n.roughness &&
    m.opacity === n.opacity &&
    m.emissive === n.emissive &&
    m.wireframe === n.wireframe &&
    m.flat_shading === n.flat_shading
  );
}

// ── Hierarchy ───────────────────────────────────────────────────────────────

/** Children by parent id; `""` holds the roots. Missing parents and loops read as roots. */
export function childrenIndex(objects: Map<string, SceneObject>): Map<string, SceneObject[]> {
  const out = new Map<string, SceneObject[]>();
  for (const o of objects.values()) {
    const parent = resolvedParent(o, objects);
    const list = out.get(parent) ?? [];
    list.push(o);
    out.set(parent, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  }
  return out;
}

/**
 * The parent the contract would report: `""` for a missing parent or a loop.
 * The same rule as `MeroModels::resolve_parents`, applied here too because the
 * local model holds optimistic edits the contract has not resolved yet.
 */
export function resolvedParent(o: SceneObject, objects: Map<string, SceneObject>): string {
  if (!o.parent) return "";
  const seen = new Set([o.id]);
  let at = o.parent;
  while (at) {
    if (seen.has(at)) return "";
    seen.add(at);
    const next = objects.get(at);
    if (!next) return "";
    at = next.parent;
  }
  return o.parent;
}

/** `id` and everything under it. */
export function descendants(id: string, objects: Map<string, SceneObject>): string[] {
  const index = childrenIndex(objects);
  const out: string[] = [];
  const walk = (at: string) => {
    out.push(at);
    for (const c of index.get(at) ?? []) walk(c.id);
  };
  walk(id);
  return out;
}

/** Would putting `id` under `parent` make a loop? */
export function wouldLoop(id: string, parent: string, objects: Map<string, SceneObject>): boolean {
  return parent !== "" && descendants(id, objects).includes(parent);
}

/** Drop any id whose ancestor is also in the set, so a branch is moved once, not twice. */
export function topmost(ids: Iterable<string>, objects: Map<string, SceneObject>): string[] {
  const set = new Set(ids);
  return [...set].filter((id) => {
    const o = objects.get(id);
    if (!o) return false;
    let at = resolvedParent(o, objects);
    while (at) {
      if (set.has(at)) return false;
      const p = objects.get(at);
      if (!p) break;
      at = resolvedParent(p, objects);
    }
    return true;
  });
}

// ── Colour per member ───────────────────────────────────────────────────────

const MEMBER_COLORS = [
  "#4f9dff",
  "#f2a33a",
  "#4cc38a",
  "#e5484d",
  "#a78bfa",
  "#2ec4c4",
  "#f76b95",
  "#c3d84a",
];

/** A stable colour for a member, the same on every screen: derived from the id, never stored. */
export function memberColor(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return MEMBER_COLORS[(h >>> 0) % MEMBER_COLORS.length]!;
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}
