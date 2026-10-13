import * as THREE from "three";
import { makeObject, newId, uniqueName, vec, type Material, type SceneObject, type Vec3 } from "./model";
import { defaultModifier } from "./modifiers";
import { at, edgeEnds, faceCenter, faceNormal, topology, vertexTotal, type Modifier, type Poly, type V3 } from "./poly";
import { bevelEdges, bisect, deleteFacesPoly, extrudeFaces, insetFaces, joinPolys, mergeAtCenter, transformPoly } from "./polyops";
import { primitivePoly, shapeFromPoly, sharpByAngle } from "./polymesh";
import { emptyChange, type Change } from "./store";

/**
 * Example assets, each built step by step with the same tools a person uses
 * in edit mode — bevel, inset, extrude, knife, merge, mirror and array
 * modifiers — so every one is an ordinary, editable cage in the scene, not
 * an imported file. Read each builder as the recipe an artist would follow.
 */

interface Part {
  name: string;
  poly: Poly;
  material: Partial<Material>;
  position?: [number, number, number];
}

export interface Example {
  key: string;
  name: string;
  blurb: string;
  build(): Part[];
}

// ── small helpers over the tools ────────────────────────────────────────────

function place(p: Poly, position: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): Poly {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion(), new THREE.Vector3(...scale));
  return transformPoly(p, m.elements);
}

const box = (w: number, h: number, d: number, at: [number, number, number] = [0, 0, 0]) => place(primitivePoly("cube", 1)!, at, [w, h, d]);

const cylinder = (r: number, h: number, segments: number, at: [number, number, number] = [0, 0, 0]) =>
  place(primitivePoly("cylinder", segments)!, at, [r * 2, h, r * 2]);

const icosphere = (r: number, detail: number, at: [number, number, number] = [0, 0, 0], squash: [number, number, number] = [1, 1, 1]) =>
  place(primitivePoly("icosphere", detail + 1)!, at, [r * 2 * squash[0], r * 2 * squash[1], r * 2 * squash[2]]);

function faces(p: Poly, test: (centre: V3, normal: V3) => boolean): Set<number> {
  const out = new Set<number>();
  p.faces.forEach((f, i) => {
    if (test(faceCenter(p, f), faceNormal(p, f))) out.add(i);
  });
  return out;
}

function verts(p: Poly, test: (v: V3) => boolean): Set<number> {
  const out = new Set<number>();
  for (let v = 0; v < vertexTotal(p); v += 1) if (test(at(p, v))) out.add(v);
  return out;
}

const allEdges = (p: Poly) => new Set(topology(p).edgeFaces.keys());

function edges(p: Poly, test: (a: V3, b: V3) => boolean): Set<number> {
  const out = new Set<number>();
  for (const key of topology(p).edgeFaces.keys()) {
    const [a, b] = edgeEnds(key);
    if (test(at(p, a), at(p, b))) out.add(key);
  }
  return out;
}

function move(p: Poly, which: Set<number>, to: (v: V3) => V3): Poly {
  const positions = p.positions.slice();
  for (const v of which) {
    const n = to(at(p, v));
    positions[v * 3] = n[0];
    positions[v * 3 + 1] = n[1];
    positions[v * 3 + 2] = n[2];
  }
  return { ...p, positions };
}

const union = (...sets: Set<number>[]) => new Set(sets.flatMap((s) => [...s]));
const modifiers = (p: Poly, ...mods: Modifier[]): Poly => ({ ...p, modifiers: mods });
const axisFacing = (n: V3, axis: 0 | 1 | 2, sign: 1 | -1) => n[axis] * sign > 0.99;

const PAINT: Partial<Material> = { color: "#d9822b", metalness: 0.55, roughness: 0.42 };
const DARK_STEEL: Partial<Material> = { color: "#3a3d44", metalness: 0.9, roughness: 0.38 };
const STEEL: Partial<Material> = { color: "#c9d1d9", metalness: 1, roughness: 0.22 };
const GOLD: Partial<Material> = { color: "#d8a94a", metalness: 1, roughness: 0.3 };
const glow = (color: string): Partial<Material> => ({ color: "#111418", emissive: color, metalness: 0, roughness: 0.4 });

// ── the examples ────────────────────────────────────────────────────────────

/** A hard-surface prop: chamfered edges, inset and recessed panels, bolted-on handles, a status light. */
function supplyCrate(): Part[] {
  let body = box(1.2, 0.8, 0.8, [0, 0.4, 0]);
  // 1. Chamfer every edge (Ctrl+B).
  body = bevelEdges(body, allEdges(body), 0.035).poly;
  // 2. The six big sides keep their indices through the bevel; inset each on its own (I), then again with depth for a recess.
  const sides = faces(body, (_c, n) => Math.max(Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])) > 0.999);
  body = insetFaces(body, sides, 0.07, 0, true).poly;
  body = insetFaces(body, sides, 0.015, -0.03, true).poly;
  // 3. Cross-bracing on the long sides: knife two planes, then extrude the strip between them.
  body = bisect(body, 0, -0.05).poly;
  body = bisect(body, 0, 0.05).poly;
  const brace = faces(body, (c, n) => Math.abs(n[2]) > 0.99 && Math.abs(c[0]) < 0.05 && c[1] > 0.1 && c[1] < 0.7);
  body = extrudeFaces(body, brace, 0.03).poly;

  const handle = (x: number) => {
    let h = box(0.06, 0.07, 0.42, [x, 0.55, 0]);
    h = bevelEdges(h, allEdges(h), 0.012).poly;
    return h;
  };
  const feet = [-0.45, 0.45].flatMap((x) =>
    [-0.28, 0.28].map((z) => {
      const foot = box(0.16, 0.05, 0.16, [x, 0.02, z]);
      return bevelEdges(foot, allEdges(foot), 0.015).poly;
    }),
  );
  return [
    { name: "Crate body", poly: body, material: PAINT },
    { name: "Handles", poly: joinPolys([handle(-0.635), handle(0.635)]), material: DARK_STEEL },
    { name: "Feet", poly: joinPolys(feet), material: DARK_STEEL },
    { name: "Status light", poly: box(0.36, 0.035, 0.02, [0, 0.72, 0.392]), material: glow("#38e8ff") },
  ];
}

/** A cylinder turned into a fuel drum with knife cuts, extruded ribs and rims, and an inset lid. */
function fuelDrum(): Part[] {
  let p = cylinder(0.34, 1, 24, [0, 0.5, 0]);
  // 1. Knife the side where the ribs and rims go.
  for (const y of [0.03, 0.07, 0.31, 0.35, 0.65, 0.69, 0.93, 0.97]) p = bisect(p, 1, y).poly;
  const band = (lo: number, hi: number) => faces(p, (c, n) => Math.abs(n[1]) < 0.1 && c[1] > lo && c[1] < hi);
  // 2. Extrude the bands outward along their normals (E): two rolling hoops, two rims.
  p = extrudeFaces(p, union(band(0.31, 0.35), band(0.65, 0.69)), 0.022).poly;
  p = extrudeFaces(p, union(band(0, 0.03), band(0.97, 1)), 0.014).poly;
  // 3. The lid: inset the cap and push it down, then a raised filler cap.
  // The cap is the one up-facing face centred on the axis (the rim's top ring faces up too).
  const top = faces(p, (c, n) => axisFacing(n, 1, 1) && c[1] > 0.99 && Math.hypot(c[0], c[2]) < 0.01);
  p = insetFaces(p, top, 0.035, -0.02).poly;
  p = insetFaces(p, top, 0.2, 0.025).poly;
  return [
    { name: "Drum", poly: p, material: { color: "#2f6db5", metalness: 0.5, roughness: 0.48 } },
    { name: "Hazard band", poly: cylinder(0.343, 0.08, 24, [0, 0.82, 0]), material: { color: "#e8c22a", metalness: 0.3, roughness: 0.5 } },
  ];
}

/**
 * A weapon prop: a blade knifed down its middle and pinched into a ridge,
 * merged to a point; a guard modelled as one half with a mirror modifier; a
 * grip with knifed and extruded wraps.
 */
function sword(): Part[] {
  let blade = box(0.16, 1.1, 0.035, [0, 0.62, 0]);
  blade = bisect(blade, 0, 0).poly; // the ridge line
  blade = move(blade, verts(blade, () => true), (v) => [v[0], v[1], Math.abs(v[0]) < 1e-6 ? v[2] * 1.6 : v[2] * 0.12]);
  const tip = mergeAtCenter(blade, verts(blade, (v) => v[1] > 1.16));
  blade = move(tip.poly, tip.verts!, (v) => [v[0], v[1] + 0.2, v[2]]);
  blade = { ...blade, sharp: sharpByAngle(blade, 25) };

  // The guard's right half; the mirror modifier makes the left.
  let guard = box(0.2, 0.06, 0.1, [0.1, 0.07, 0]);
  guard = deleteFacesPoly(guard, faces(guard, (c, n) => axisFacing(n, 0, -1) && Math.abs(c[0]) < 1e-6));
  const end = faces(guard, (_c, n) => axisFacing(n, 0, 1));
  const out = extrudeFaces(guard, end, 0.08);
  guard = move(out.poly, verts(out.poly, (v) => v[0] > 0.25), (v) => [v[0], v[1] + 0.045, v[2] * 0.6]);
  guard = modifiers({ ...guard, sharp: sharpByAngle(guard, 30) }, defaultModifier("mirror"));

  let grip = cylinder(0.032, 0.3, 12, [0, -0.11, 0]);
  const cuts = [-0.22, -0.2, -0.16, -0.14, -0.1, -0.08, -0.04, -0.02];
  for (const y of cuts) grip = bisect(grip, 1, y).poly;
  const wraps = union(...[[-0.22, -0.2], [-0.16, -0.14], [-0.1, -0.08], [-0.04, -0.02]].map(([lo, hi]) =>
    faces(grip, (c, n) => Math.abs(n[1]) < 0.1 && c[1] > lo! && c[1] < hi!),
  ));
  grip = extrudeFaces(grip, wraps, 0.006).poly;

  return [
    { name: "Blade", poly: blade, material: STEEL },
    { name: "Guard", poly: guard, material: GOLD },
    { name: "Grip", poly: grip, material: { color: "#5a3a22", metalness: 0, roughness: 0.85 } },
    { name: "Pommel", poly: icosphere(0.05, 1, [0, -0.3, 0]), material: GOLD },
  ];
}

/**
 * A modular sci-fi corridor kit: one wall panel, one pillar and one floor
 * tile, each repeated by an array modifier — change the panel and every copy
 * follows, as a level artist's kit should.
 */
function corridorKit(): Part[] {
  const SPAN = 2.3;
  let wall = box(2, 3, 0.2, [0, 1.5, 0]);
  for (const y of [0.4, 2.6]) wall = bisect(wall, 1, y).poly;
  const front = () => faces(wall, (_c, n) => axisFacing(n, 2, 1));
  wall = insetFaces(wall, front(), 0.06, -0.04, true).poly;
  const main = faces(wall, (c, n) => axisFacing(n, 2, 1) && c[1] > 0.5 && c[1] < 2.5);
  wall = insetFaces(wall, main, 0.22, 0.03, true).poly;
  wall = modifiers(wall, { type: "array", count: 3, offset: [SPAN, 0, 0], on: true });

  let pillar = box(0.3, 3, 0.4, [SPAN / 2, 1.5, 0.05]);
  pillar = bevelEdges(pillar, edges(pillar, (a, b) => Math.abs(a[1] - b[1]) > 1), 0.06).poly;
  pillar = insetFaces(pillar, faces(pillar, (_c, n) => axisFacing(n, 2, 1)), 0.05, -0.03).poly;
  pillar = modifiers(pillar, { type: "array", count: 2, offset: [SPAN, 0, 0], on: true });

  let floor = box(SPAN * 3, 0.1, 2.4, [SPAN, -0.05, 1.1]);
  for (let i = 1; i < 6; i += 1) floor = bisect(floor, 0, -SPAN / 2 + (i * SPAN * 3) / 6).poly;
  for (const z of [0.3, 1.1, 1.9]) floor = bisect(floor, 2, z).poly;
  floor = insetFaces(floor, faces(floor, (_c, n) => axisFacing(n, 1, 1)), 0.03, -0.015, true).poly;

  return [
    { name: "Wall panel", poly: wall, material: { color: "#8b929c", metalness: 0.6, roughness: 0.45 } },
    { name: "Pillar", poly: pillar, material: DARK_STEEL },
    { name: "Floor tiles", poly: floor, material: { color: "#4a4f57", metalness: 0.4, roughness: 0.6 } },
    {
      name: "Light strips",
      poly: modifiers(box(1.5, 0.05, 0.03, [0, 2.78, 0.12]), { type: "array", count: 3, offset: [SPAN, 0, 0], on: true }),
      material: glow("#7fd4ff"),
    },
  ];
}

/** Deterministic lumpy noise, so the same example is the same mesh on every machine. */
function lump(v: V3, amount: number, seed: number): V3 {
  const [x, y, z] = v;
  const n = Math.sin(x * 7.1 + y * 3.3 + seed) * 0.5 + Math.sin(y * 5.7 + z * 8.9 + seed * 2) * 0.3 + Math.sin(z * 4.3 + x * 6.1 + seed * 3) * 0.2;
  const len = Math.hypot(x, y, z) || 1;
  const k = 1 + (n * amount) / len;
  return [x * k, y * k, z * k];
}

/** Stylised environment pieces: a low-poly rock and a tree, shaped by moving vertices and extruding. */
function rockAndTree(): Part[] {
  let rock = icosphere(0.5, 2, [0, 0, 0], [1.2, 0.7, 0.9]);
  rock = move(rock, verts(rock, () => true), (v) => lump(v, 0.09, 1.3));
  rock = place(rock, [0, 0.25, 0]);

  let trunk = cylinder(0.11, 0.7, 7, [0.9, 0.35, 0]);
  // Extrude the top twice, narrowing and leaning each step: a trunk that tapers into a bough.
  for (const [rise, shrink, lean] of [[0.45, 0.72, 0.06], [0.35, 0.65, -0.05]] as const) {
    const top = faces(trunk, (_c, n) => axisFacing(n, 1, 1));
    const up = extrudeFaces(trunk, top, rise);
    const highest = Math.max(...[...verts(up.poly, () => true)].map((i) => up.poly.positions[i * 3 + 1]!));
    const ring = verts(up.poly, (v) => v[1] > highest - 1e-6);
    const c = [...ring].reduce<V3>((s, i) => [s[0] + up.poly.positions[i * 3]! / ring.size, s[1], s[2] + up.poly.positions[i * 3 + 2]! / ring.size], [0, 0, 0]);
    trunk = move(up.poly, ring, (v) => [c[0] + (v[0] - c[0]) * shrink + lean, v[1], c[2] + (v[2] - c[2]) * shrink]);
  }
  const crown = ([[0.95, 1.75, 0, 0.42], [0.7, 1.55, 0.15, 0.3], [1.2, 1.5, -0.1, 0.32]] as const).map(([x, y, z, r], i) => {
    const ball = icosphere(r, 1);
    return place(move(ball, verts(ball, () => true), (v) => lump(v, 0.05, i + 4)), [x, y, z]);
  });
  return [
    { name: "Rock", poly: rock, material: { color: "#7d7a74", roughness: 0.9, flat_shading: true } },
    { name: "Trunk", poly: trunk, material: { color: "#6b4a2f", roughness: 0.85, flat_shading: true } },
    { name: "Foliage", poly: joinPolys(crown), material: { color: "#4f9a45", roughness: 0.75, flat_shading: true } },
  ];
}

export const EXAMPLES: Example[] = [
  { key: "crate", name: "Sci-fi supply crate", blurb: "Hard-surface prop: bevelled edges, inset and recessed panels, extruded bracing.", build: supplyCrate },
  { key: "drum", name: "Fuel drum", blurb: "Knife cuts and extruded hoops and rims on a cylinder; an inset lid.", build: fuelDrum },
  { key: "sword", name: "Sword", blurb: "Weapon prop: a ridged blade merged to a point, a mirrored guard, a wrapped grip.", build: sword },
  { key: "corridor", name: "Corridor kit", blurb: "Modular level kit: wall, pillar and floor pieces repeated by array modifiers.", build: corridorKit },
  { key: "nature", name: "Rock and tree", blurb: "Stylised environment pieces: displaced low-poly rock, a tapered extruded trunk.", build: rockAndTree },
];

/** Where each example sits when they are all loaded together. */
const SHOWCASE: Record<string, { at: Vec3; scale?: number; turn?: number }> = {
  crate: { at: vec(-3.4, 0, 1.2), turn: -0.35 },
  drum: { at: vec(-1.7, 0, 1.4) },
  sword: { at: vec(-0.4, 0.33, 1.6), turn: 0.5 },
  nature: { at: vec(1.2, 0, 1.2) },
  // Lifted by its floor's thickness, so its tiles sit on the showcase floor.
  corridor: { at: vec(-2.3, 0.03, -1.6), scale: 0.6 },
};

/**
 * The objects and meshes that add an example (or, for `"showcase"`, every
 * example together with a floor and a sun) to a scene, as one change.
 */
export function exampleChange(key: string, takenNames: string[], at: Vec3 = vec()): { change: Change; roots: string[] } {
  const change = emptyChange();
  const taken = takenNames.slice();
  const roots: string[] = [];
  const keys = key === "showcase" ? EXAMPLES.map((e) => e.key) : [key];
  for (const k of keys) {
    const example = EXAMPLES.find((e) => e.key === k);
    if (!example) continue;
    const spot = key === "showcase" ? SHOWCASE[k]! : { at };
    const group = makeObject("group", taken);
    group.name = uniqueName(example.name, taken);
    taken.push(group.name);
    group.position = { ...spot.at };
    if (spot.scale) group.scale = vec(spot.scale, spot.scale, spot.scale);
    if (spot.turn) group.rotation = vec(0, spot.turn, 0);
    change.puts.push(group);
    roots.push(group.id);
    for (const part of example.build()) {
      const o = partObject(part, group.id, taken);
      change.puts.push(o);
      change.meshes.push({ id: o.id, shape: shapeFromPoly(part.poly), message: `Example: ${example.name}` });
    }
  }
  if (key === "showcase") {
    const floor = makeObject("mesh", taken);
    floor.name = uniqueName("Showcase floor", taken);
    floor.material = { ...floor.material, color: "#2b2d33", roughness: 0.8 };
    change.puts.push(floor);
    change.meshes.push({ id: floor.id, shape: shapeFromPoly(box(8.5, 0.1, 5.5, [-0.6, -0.05, 0.2])) });
    const sun = makeObject("directional_light", taken);
    change.puts.push(sun);
    roots.push(floor.id, sun.id);
  }
  return { change, roots };
}

function partObject(part: Part, parent: string, taken: string[]): SceneObject {
  const o = makeObject("mesh", taken);
  o.id = newId();
  o.name = uniqueName(part.name, taken);
  taken.push(o.name);
  o.parent = parent;
  o.position = part.position ? vec(...part.position) : vec();
  o.material = { ...o.material, ...part.material };
  return o;
}
