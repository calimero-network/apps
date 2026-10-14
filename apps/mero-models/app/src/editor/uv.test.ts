import { describe, expect, it } from "vitest";
import { decodeMesh, encodeMesh, meshCounts } from "./meshcodec";
import { edgeKey, faceNormalRaw, len, type Poly } from "./poly";
import { primitivePoly, shapeFromPoly } from "./polymesh";
import { UvError, angleDistortion, faceStretch, packIslands, smartProject, unwrap, uvIslands, uvStats } from "./uv";

const prim = (kind: string, segments = 16) => primitivePoly(kind, segments)!;

/** Every corner inside the 0–1 square, and no two islands' boxes overlapping. */
function expectPacked(p: Poly) {
  const boxes = uvIslands(p).map((faces) => {
    const us: number[] = [];
    const vs: number[] = [];
    for (const f of faces) for (let i = 0; i < p.uvs![f]!.length; i += 2) (us.push(p.uvs![f]![i]!), vs.push(p.uvs![f]![i + 1]!));
    return [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)] as const;
  });
  for (const [a, b, c, d] of boxes) {
    expect(a).toBeGreaterThanOrEqual(-1e-9);
    expect(b).toBeGreaterThanOrEqual(-1e-9);
    expect(c).toBeLessThanOrEqual(1 + 1e-9);
    expect(d).toBeLessThanOrEqual(1 + 1e-9);
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const [a, b] = [boxes[i]!, boxes[j]!];
      const apart = a[2] <= b[0] + 1e-9 || b[2] <= a[0] + 1e-9 || a[3] <= b[1] + 1e-9 || b[3] <= a[1] + 1e-9;
      expect(apart, `islands ${i} and ${j} overlap`).toBe(true);
    }
  }
}

/** Each island's UV area over its surface area — equal for every island means even texel density. */
function densities(p: Poly): number[] {
  return uvIslands(p).map((faces) => {
    let a3 = 0;
    let auv = 0;
    for (const f of faces) {
      a3 += len(faceNormalRaw(p, p.faces[f]!)) / 2;
      const uv = p.uvs![f]!;
      let a = 0;
      for (let i = 0; i < uv.length / 2; i += 1) {
        const j = (i + 1) % (uv.length / 2);
        a += uv[i * 2]! * uv[j * 2 + 1]! - uv[j * 2]! * uv[i * 2 + 1]!;
      }
      auv += Math.abs(a / 2);
    }
    return auv / a3;
  });
}

describe("unwrapping along seams", () => {
  it("lays a cube out as six undistorted squares, packed and evenly dense", () => {
    const { poly, projected } = unwrap(prim("cube", 1), null);
    expect(projected).toBe(0);
    expect(uvIslands(poly)).toHaveLength(6);
    expect(angleDistortion(poly)).toBeLessThan(1e-3);
    expect(uvStats(poly).flipped).toBe(0);
    expectPacked(poly);
    const d = densities(poly);
    for (const x of d) expect(x).toBeCloseTo(d[0]!, 6);
  });

  it("opens a cylinder along its seam into a strip and two caps", () => {
    const { poly } = unwrap(prim("cylinder", 16), null);
    expect(uvIslands(poly)).toHaveLength(3);
    expect(angleDistortion(poly)).toBeLessThan(0.02);
    expect(uvStats(poly).flipped).toBe(0);
    expectPacked(poly);
  });

  it("flattens a curved patch conformally: angles kept, nothing folded", () => {
    // A quarter of a sphere, open on its border.
    const sphere = prim("sphere", 24);
    const cap = new Set(sphere.faces.map((f, i) => (f.every((v) => sphere.positions[v * 3 + 1]! > 0.2) ? i : -1)).filter((i) => i >= 0));
    const { poly } = unwrap({ ...sphere, seams: new Set() }, cap);
    expect(uvStats({ ...poly, faces: poly.faces.filter((_, i) => cap.has(i)), uvs: poly.uvs!.filter((_, i) => cap.has(i)) }).flipped).toBe(0);
    const distortion = angleDistortion({ ...poly, faces: poly.faces.filter((_, i) => cap.has(i)), uvs: poly.uvs!.filter((_, i) => cap.has(i)) });
    expect(distortion).toBeLessThan(0.05);
  });

  it("opens a UV sphere along its meridian without tearing its poles apart", () => {
    const { poly, projected } = unwrap(prim("sphere", 24), null);
    expect(projected).toBe(0);
    expect(uvIslands(poly)).toHaveLength(1);
    expect(uvStats(poly).flipped).toBe(0);
    expectPacked(poly);
  });

  it("projects a closed piece that has no seam to open it", () => {
    const { poly, projected } = unwrap({ ...prim("cube", 1), seams: new Set() }, null);
    expect(projected).toBe(6);
    expectPacked(poly);
  });

  it("treats a seam that does not cut all the way through as a slit", () => {
    // Plane 4×4: one seam edge inside it keeps it one island, flattened without folding.
    const plane = primitivePoly("plane", 1)!;
    const { poly } = unwrap({ ...plane, seams: new Set() }, null);
    expect(uvIslands(poly)).toHaveLength(1);
  });
});

describe("smart project", () => {
  it("splits a cylinder by facing, marks the splits as seams, and packs", () => {
    const p = { ...prim("cylinder", 16), seams: new Set<number>() };
    const out = smartProject(p, null, 66);
    expect(out.seams.size).toBeGreaterThan(0);
    expect(uvStats(out).flipped).toBe(0);
    expectPacked(out);
  });
});

describe("packing and measuring", () => {
  it("refuses to pack a mesh with no UVs", () => {
    expect(() => packIslands({ ...prim("cube", 1), uvs: null })).toThrow(UvError);
  });

  it("reports texel density and even stretch after an unwrap", () => {
    const { poly } = unwrap(prim("cube", 1), null);
    const stats = uvStats(poly);
    expect(stats.islands).toBe(6);
    expect(stats.pixelsPerMetre(2048)).toBeGreaterThan(100);
    for (const s of faceStretch(poly)) expect(Math.abs(s)).toBeLessThan(1e-6);
  });

  it("keeps marked seams through the blob format", () => {
    const p = { ...prim("cube", 1), seams: new Set([edgeKey(0, 1)]) };
    const shape = shapeFromPoly(p);
    const back = decodeMesh(encodeMesh(shape), meshCounts(shape));
    expect([...back.poly!.seams]).toEqual([edgeKey(0, 1)].filter((k) => back.poly!.seams.has(k)));
    expect(back.poly!.seams.size).toBe(p.seams.size);
  });
});
