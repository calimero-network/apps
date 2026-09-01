// Chunk mesher: culled faces, per-vertex color + (sun, block) light baked in.
// Pure data-out (typed arrays) so it is unit-testable without a GPU.

import { AIR, blockDef, GLASS, isOpaque, LEAVES, TORCH, WATER } from "./blocks";
import { CHUNK, WorldStore } from "./world";
import { LightGrid } from "./lighting";

export interface MeshData {
  positions: Float32Array;
  colors: Float32Array;
  /** interleaved [sun, block] per vertex, 0..1 */
  light: Float32Array;
  indices: Uint32Array;
  faceCount: number;
}

interface Builder {
  positions: number[];
  colors: number[];
  light: number[];
  indices: number[];
  faces: number;
}

const newBuilder = (): Builder => ({ positions: [], colors: [], light: [], indices: [], faces: 0 });

// dir + 4 corner offsets (CCW from outside); quad indices 0,1,2, 2,1,3
const FACES: { dir: [number, number, number]; corners: [number, number, number][] }[] = [
  { dir: [-1, 0, 0], corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]] },
  { dir: [1, 0, 0], corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]] },
  { dir: [0, -1, 0], corners: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]] },
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]] },
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] },
];

/** simple directional shading so unlit geometry still reads as 3D */
const faceShade = (dir: [number, number, number]): number => {
  if (dir[1] > 0) return 1.0;
  if (dir[1] < 0) return 0.55;
  if (dir[0] !== 0) return 0.8;
  return 0.7;
};

function pushFace(
  b: Builder,
  x: number,
  y: number,
  z: number,
  face: (typeof FACES)[number],
  color: [number, number, number],
  sun: number,
  block: number,
  scale = 1,
  offset = 0,
): void {
  const base = b.positions.length / 3;
  const shade = faceShade(face.dir);
  for (const [cx, cy, cz] of face.corners) {
    b.positions.push(x + offset + cx * scale, y + cy * scale, z + offset + cz * scale);
    b.colors.push(color[0] * shade, color[1] * shade, color[2] * shade);
    b.light.push(sun / 15, block / 15);
  }
  b.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  b.faces++;
}

const finish = (b: Builder): MeshData => ({
  positions: new Float32Array(b.positions),
  colors: new Float32Array(b.colors),
  light: new Float32Array(b.light),
  indices: new Uint32Array(b.indices),
  faceCount: b.faces,
});

/** which face color slot for a direction: top / bottom / side */
const colorFor = (def: ReturnType<typeof blockDef>, dir: [number, number, number]) =>
  dir[1] > 0 ? def.colors[0] : dir[1] < 0 ? def.colors[2] : def.colors[1];

export function buildChunkMesh(
  store: WorldStore,
  light: LightGrid,
  cx: number,
  cy: number,
  cz: number,
): { opaque: MeshData; translucent: MeshData } {
  const opaque = newBuilder();
  const translucent = newBuilder();
  const bx = cx * CHUNK,
    by = cy * CHUNK,
    bz = cz * CHUNK;

  for (let ly = 0; ly < CHUNK; ly++)
    for (let lz = 0; lz < CHUNK; lz++)
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = bx + lx,
          y = by + ly,
          z = bz + lz;
        const id = store.getBlock(x, y, z);
        if (id === AIR) continue;
        const def = blockDef(id);

        if (id === TORCH) {
          // free-standing mini-cuboid, lit by its own cell, never culled
          const sun = light.sunAt(x, y, z);
          const bl = light.blockAt(x, y, z);
          for (const face of FACES)
            pushFace(opaque, x, y, z, face, def.colors[0], sun, bl, 0.3, 0.35);
          continue;
        }

        const target = id === WATER || id === GLASS ? translucent : opaque;

        for (const face of FACES) {
          const nx = x + face.dir[0],
            ny = y + face.dir[1],
            nz = z + face.dir[2];
          const nId = store.getBlock(nx, ny, nz);
          // cull: hidden against opaque neighbors, and same-type transparent
          // neighbors (no internal faces inside water/glass/leaf volumes)
          if (isOpaque(nId)) continue;
          if ((id === WATER || id === GLASS || id === LEAVES) && nId === id) continue;
          const sun = light.sunAt(nx, ny, nz);
          const bl = light.blockAt(nx, ny, nz);
          pushFace(target, x, y, z, face, colorFor(def, face.dir), sun, bl);
        }
      }

  return { opaque: finish(opaque), translucent: finish(translucent) };
}
