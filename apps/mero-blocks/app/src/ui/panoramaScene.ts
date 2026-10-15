// The panorama's world, as plain data: generated, lit and meshed with no DOM
// and no GPU, so it can be built off the main thread (panorama.worker.ts) and
// handed over as transferable typed arrays.

import { LightGrid } from "../engine/lighting";
import { buildChunkMesh, type MeshData } from "../engine/mesher";
import { generateWorld, spawnPoint } from "../engine/terrain";
import { WorldStore, WORLD_CX, WORLD_CY, WORLD_CZ, chunkKey } from "../engine/world";

export interface PanoramaChunk {
  key: string;
  opaque: MeshData;
  translucent: MeshData;
}

export interface PanoramaScene {
  eye: { x: number; y: number; z: number };
  chunks: PanoramaChunk[];
}

export function buildPanoramaScene(seed: number): PanoramaScene {
  const world = new WorldStore();
  generateWorld(world, seed);
  const light = new LightGrid();
  light.recomputeAll(world);
  const chunks: PanoramaChunk[] = [];
  for (let cx = 0; cx < WORLD_CX; cx++)
    for (let cy = 0; cy < WORLD_CY; cy++)
      for (let cz = 0; cz < WORLD_CZ; cz++) {
        const mesh = buildChunkMesh(world, light, cx, cy, cz);
        chunks.push({ key: chunkKey(cx, cy, cz), opaque: mesh.opaque, translucent: mesh.translucent });
      }
  return { eye: spawnPoint(seed), chunks };
}

/** The buffers to transfer (not copy) when posting `scene` out of the worker. */
export function sceneTransferables(scene: PanoramaScene): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const c of scene.chunks)
    for (const m of [c.opaque, c.translucent])
      out.push(
        m.positions.buffer as ArrayBuffer,
        m.colors.buffer as ArrayBuffer,
        m.light.buffer as ArrayBuffer,
        m.indices.buffer as ArrayBuffer,
      );
  return out;
}
