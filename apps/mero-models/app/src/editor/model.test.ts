import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_BATCH,
  MAX_OBJECTS,
  MAX_TRIANGLES,
  MAX_VERTICES,
  OBJECT_KINDS,
  childrenIndex,
  descendants,
  makeObject,
  memberColor,
  resolvedParent,
  topmost,
  uniqueName,
  wouldLoop,
  type SceneObject,
} from "./model";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT = readFileSync(resolve(HERE, "..", "..", "..", "logic", "src", "lib.rs"), "utf8");

describe("the frontend's copies of the contract's rules", () => {
  it("knows exactly the kinds the contract accepts", () => {
    const block = /pub const OBJECT_KINDS: &\[&str\] = &\[([\s\S]*?)\];/.exec(CONTRACT)![1]!;
    const kinds = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect([...OBJECT_KINDS]).toEqual(kinds);
  });

  it("uses the contract's limits", () => {
    const limit = (name: string) => Number(new RegExp(`pub const ${name}: usize = ([\\d_]+);`).exec(CONTRACT)![1]!.replace(/_/g, ""));
    expect(MAX_BATCH).toBe(limit("MAX_BATCH"));
    expect(MAX_OBJECTS).toBe(limit("MAX_OBJECTS"));
    expect(MAX_VERTICES).toBe(limit("MAX_VERTICES"));
    expect(MAX_TRIANGLES).toBe(limit("MAX_TRIANGLES"));
  });
});

function obj(id: string, parent = ""): SceneObject {
  return { ...makeObject("cube", []), id, name: id, parent };
}

function scene(...objects: SceneObject[]): Map<string, SceneObject> {
  return new Map(objects.map((o) => [o.id, o]));
}

describe("hierarchy", () => {
  it("resolves a missing parent and a loop to the root, as the contract does", () => {
    const s = scene(obj("a"), obj("b", "a"), obj("c", "ghost"), obj("e", "f"), obj("f", "e"));
    expect(resolvedParent(s.get("b")!, s)).toBe("a");
    expect(resolvedParent(s.get("c")!, s)).toBe("");
    expect(resolvedParent(s.get("e")!, s)).toBe("");
    expect(childrenIndex(s).get("")!.map((o) => o.id).sort()).toEqual(["a", "c", "e", "f"]);
  });

  it("refuses a re-parent that would loop", () => {
    const s = scene(obj("a"), obj("b", "a"), obj("c", "b"));
    expect(wouldLoop("a", "c", s)).toBe(true);
    expect(wouldLoop("c", "a", s)).toBe(false);
    expect(descendants("a", s)).toEqual(["a", "b", "c"]);
  });

  it("moves a branch once, not once per selected member of it", () => {
    const s = scene(obj("a"), obj("b", "a"), obj("x"));
    expect(topmost(["b", "a", "x"], s).sort()).toEqual(["a", "x"]);
  });
});

describe("names and colours", () => {
  it("numbers names the way Blender does", () => {
    expect(uniqueName("Cube", [])).toBe("Cube");
    expect(uniqueName("Cube", ["Cube"])).toBe("Cube.001");
    expect(uniqueName("Cube.001", ["Cube", "Cube.001"])).toBe("Cube.002");
  });

  it("gives a member the same colour everywhere", () => {
    expect(memberColor("abc")).toBe(memberColor("abc"));
    expect(memberColor("abc")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("puts new solids on the ground and lights above it", () => {
    expect(makeObject("cube", []).position.y).toBe(0.5);
    expect(makeObject("plane", []).position.y).toBe(0);
    expect(makeObject("point_light", []).position.y).toBeGreaterThan(1);
  });
});
