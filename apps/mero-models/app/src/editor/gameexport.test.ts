import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { describe, expect, it } from "vitest";
import { boxHull, convexHull } from "./collision";
import { writeFbx } from "./fbx";
import { geometryFromShape, type MeshShape } from "./geometry";
import { simplify } from "./lod";
import { buildGameExport, checkPlan, names, planExport } from "./gameexport";
import { makeObject, vec } from "./model";
import { BUDGETS } from "./validate";
import { unzipSync } from "fflate";
import { primitivePoly, shapeFromPoly } from "./polymesh";
import { smartProject } from "./uv";

const sphere = (s = 48) => shapeFromPoly(smartProject(primitivePoly("sphere", s)!, null, 66, 0.01));

/** Every edge of an indexed triangle mesh used by exactly two triangles, welded by position. */
function closed(shape: MeshShape): boolean {
  const key = (i: number) => `${shape.positions[i * 3]},${shape.positions[i * 3 + 1]},${shape.positions[i * 3 + 2]}`;
  const use = new Map<string, number>();
  for (let t = 0; t < shape.indices.length; t += 3) {
    for (let j = 0; j < 3; j += 1) {
      const a = key(shape.indices[t + j]!);
      const b = key(shape.indices[t + ((j + 1) % 3)]!);
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      use.set(k, (use.get(k) ?? 0) + 1);
    }
  }
  return [...use.values()].every((n) => n === 2);
}

describe("levels of detail", () => {
  it("halves a sphere's triangles and keeps it closed, with every UV a real vertex's", () => {
    const s = sphere();
    const lod = simplify(s, 0.5);
    expect(lod.to).toBeLessThanOrEqual(Math.ceil(lod.from * 0.5) + 2);
    expect(lod.to).toBeGreaterThan(lod.from * 0.3);
    expect(closed(lod.shape)).toBe(true);
    expect(lod.shape.uvs!.length / 2).toBe(lod.shape.positions.length / 3);
    for (const x of lod.shape.uvs!) expect(x >= 0 && x <= 1).toBe(true);
  });

  it("keeps the silhouette: a quarter of the triangles stays close to the sphere", () => {
    const lod = simplify(sphere(), 0.25).shape;
    for (let i = 0; i < lod.positions.length; i += 3) {
      expect(Math.hypot(lod.positions[i]!, lod.positions[i + 1]!, lod.positions[i + 2]!)).toBeCloseTo(0.5, 5);
    }
  });

  it("leaves a mesh alone when asked for at least as many triangles", () => {
    const s = sphere(16);
    expect(simplify(s, 1).to).toBe(s.indices.length / 3);
  });
});

describe("collision", () => {
  it("wraps a sphere in a closed convex hull of at most the points it is allowed", () => {
    const hull = convexHull(sphere(), 32)!;
    expect(hull.positions.length / 3).toBeLessThanOrEqual(32);
    expect(closed(hull)).toBe(true);
    // Convex and outward: every hull point is behind every face's plane.
    for (let t = 0; t < hull.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((j) => new THREE.Vector3().fromArray(hull.positions, hull.indices[t + j]! * 3));
      const n = new THREE.Vector3().subVectors(b!, a!).cross(new THREE.Vector3().subVectors(c!, a!)).normalize();
      expect(n.dot(a!)).toBeGreaterThan(0);
      for (let i = 0; i < hull.positions.length; i += 3) expect(n.dot(new THREE.Vector3().fromArray(hull.positions, i).sub(a!))).toBeLessThan(1e-6);
    }
  });

  it("refuses a flat mesh a hull, and boxes anything", () => {
    expect(convexHull(shapeFromPoly(primitivePoly("plane", 1)!))).toBeNull();
    const box = boxHull(sphere(16))!;
    expect(box.indices.length).toBe(36);
    expect(closed(box)).toBe(true);
  });
});

describe("the FBX writer", () => {
  it("writes a binary FBX that three.js's FBX loader reads back: names, triangles, normals, UVs and the transform", () => {
    const s = sphere(16);
    const g = geometryFromShape(s).toNonIndexed();
    const bytes = writeFbx([
      {
        name: "SM_Ball",
        positions: g.getAttribute("position").array as Float32Array,
        normals: g.getAttribute("normal").array as Float32Array,
        uvs: g.getAttribute("uv").array as Float32Array,
        translation: [1, 2, 3],
        rotation: [0, 90, 0],
        scale: [1, 1, 1],
        material: { name: "M_Ball", color: [1, 0.5, 0.25] },
      },
    ]);
    expect(new TextDecoder().decode(bytes.subarray(0, 18))).toBe("Kaydara FBX Binary");
    const group = new FBXLoader().parse(bytes.buffer as ArrayBuffer, "");
    const mesh = group.getObjectByName("SM_Ball") as THREE.Mesh;
    expect(mesh).toBeTruthy();
    const geometry = mesh.geometry as THREE.BufferGeometry;
    expect(geometry.getAttribute("position").count).toBe(s.indices.length);
    expect(geometry.getAttribute("uv")).toBeTruthy();
    expect(geometry.getAttribute("normal")).toBeTruthy();
    // Centimetres: a unit sphere of radius 0.5 m reads back as 50.
    const box = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute("position") as THREE.BufferAttribute);
    expect(box.max.y).toBeCloseTo(50, 3);
    expect(mesh.position.toArray()).toEqual([100, 200, 300]);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2, 5);
    expect((mesh.material as THREE.Material).name).toBe("M_Ball");
  });
});

describe("game export", () => {
  const crateLike = () => {
    const o = makeObject("mesh", []);
    o.name = "Supply crate";
    return o;
  };
  const opts = { engine: "unreal" as const, format: "fbx" as const, lods: 2, lodRatio: 0.5, collision: "hull" as const };

  it("names pieces by each engine's import conventions", () => {
    expect(names("unreal", "Supply crate").collision).toBe("UCX_SM_Supply_crate_00");
    expect(names("unreal", "Supply crate").lod(1, true)).toBe("SM_Supply_crate_LOD1");
    expect(names("unity", "Supply crate").lod(0, true)).toBe("Supply_crate_LOD0");
    expect(names("godot", "Supply crate").collision).toBe("Supply_crate-colonly");
  });

  it("stops the LOD chain where a level would save almost nothing", () => {
    const o = crateLike();
    const box = shapeFromPoly(primitivePoly("cube", 1)!);
    const plan = planExport([o], new Map([[o.id, o]]), () => box, { ...opts, lods: 3 });
    expect(plan[0]!.lods).toHaveLength(1);
  });

  it("plans a chain of LODs, each about half the last, and a collider", () => {
    const o = crateLike();
    const all = new Map([[o.id, o]]);
    const plan = planExport([o], all, () => sphere(), opts);
    const tris = plan[0]!.lods.map((l) => l.shape.indices.length / 3);
    expect(tris).toHaveLength(3);
    expect(tris[1]!).toBeLessThan(tris[0]! * 0.6);
    expect(tris[2]!).toBeLessThan(tris[1]! * 0.6);
    expect(plan[0]!.collision!.name).toBe("UCX_SM_Supply_crate_00");
  });

  it("checks the asset against a budget and flags what an engine would trip over", () => {
    const o = crateLike();
    o.scale = vec(2, 2, 2);
    const all = new Map([[o.id, o]]);
    const noUvs = { ...sphere(), uvs: undefined };
    const plan = planExport([o], all, () => noUvs, opts);
    const checks = checkPlan(plan, [{ id: "t", name: "Big", blob_id: "", size: 0, width: 3000, height: 3000, mime: "image/png", color_space: "srgb", author: "", message: "", updated_at: 0 }], BUDGETS.find((b) => b.key === "mobile")!);
    const text = checks.map((c) => `${c.severity}: ${c.text}`).join("\n");
    expect(text).toMatch(/error: No UVs/);
    expect(text).toMatch(/warning: Scaled 2 × 2 × 2/);
    expect(text).toMatch(/not a power of two/);
    expect(text).toMatch(/error: .*triangles at LOD 0/);
    expect(checks[0]!.severity).toBe("error");
  });

  it("writes an FBX zip whose FBX holds every LOD and the collider, with a report beside it", async () => {
    const o = crateLike();
    o.position = vec(1, 0, 0);
    const all = new Map([[o.id, o]]);
    const plan = planExport([o], all, () => sphere(), opts);
    const out = await buildGameExport(plan, checkPlan(plan, [], BUDGETS[1]!), opts, "Crate kit", null);
    expect(out.filename).toBe("Crate_kit.zip");
    const files = unzipSync(out.data);
    expect(Object.keys(files).sort()).toEqual(["Crate_kit.fbx", "Crate_kit_report.txt"]);
    const group = new FBXLoader().parse(files["Crate_kit.fbx"]!.buffer as ArrayBuffer, "");
    for (const name of ["SM_Supply_crate", "SM_Supply_crate_LOD1", "SM_Supply_crate_LOD2", "UCX_SM_Supply_crate_00"]) {
      const mesh = group.getObjectByName(name);
      expect(mesh, name).toBeTruthy();
      expect(mesh!.position.x).toBeCloseTo(100, 3);
    }
    expect(new TextDecoder().decode(files["Crate_kit_report.txt"])).toMatch(/SM_Supply_crate_LOD2: \d+ triangles/);
  });
});
