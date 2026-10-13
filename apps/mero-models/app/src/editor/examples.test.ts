import { describe, expect, it } from "vitest";
import { EXAMPLES, exampleChange } from "./examples";
import { decodeMesh, encodeMesh, meshCounts } from "./meshcodec";
import { evaluate } from "./modifiers";
import { topology, type Poly } from "./poly";

/** Edges with other than two faces, and directed edges used twice (faces wound against their neighbours). */
function defects(p: Poly): { open: number; nonManifold: number; flipped: number } {
  const t = topology(p);
  let open = 0;
  let nonManifold = 0;
  for (const faces of t.edgeFaces.values()) {
    if (faces.length === 1) open += 1;
    if (faces.length > 2) nonManifold += 1;
  }
  let directed = 0;
  for (const f of p.faces) directed += f.length;
  return { open, nonManifold, flipped: directed - t.directed.size };
}

describe("the example assets", () => {
  for (const example of EXAMPLES) {
    it(`${example.name} builds closed, consistently wound parts`, () => {
      for (const part of example.build()) {
        const evaluated = evaluate(part.poly).poly;
        expect(defects(evaluated), `${example.name} / ${part.name}`).toEqual({ open: 0, nonManifold: 0, flipped: 0 });
      }
    });
  }

  it("load as one change, every mesh a cage that survives the blob format", () => {
    const { change, roots } = exampleChange("showcase", []);
    expect(roots.length).toBe(EXAMPLES.length + 2);
    expect(change.puts.filter((o) => o.kind === "group")).toHaveLength(EXAMPLES.length);
    for (const m of change.meshes) {
      expect(m.shape.poly).toBeDefined();
      const back = decodeMesh(encodeMesh(m.shape), meshCounts(m.shape));
      expect(back.poly!.faces).toEqual(m.shape.poly!.faces);
    }
    const ids = new Set(change.puts.map((o) => o.id));
    for (const o of change.puts) if (o.parent) expect(ids.has(o.parent)).toBe(true);
  });
});
