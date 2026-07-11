// 2D lighting: sky light drops straight down until blocked, then everything
// spreads with -1 attenuation (4-neighbor BFS). Torches add block light.
// The whole grid is 400x200 = 80k cells, so a full recompute is fast enough
// to run on any edit — no incremental bookkeeping needed at this scale.

import { emissive, isOpaque } from "./tiles";
import { TileStore, WORLD_H, WORLD_W } from "./world";

const SIZE = WORLD_W * WORLD_H;

export class LightGrid {
  /** sky light 0..15 (scaled by dayFactor at render time) */
  sky = new Uint8Array(SIZE);
  /** block light 0..15 (torches — unaffected by time of day) */
  block = new Uint8Array(SIZE);

  skyAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return 15;
    return this.sky[x + y * WORLD_W];
  }

  blockAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return 0;
    return this.block[x + y * WORLD_W];
  }

  recompute(store: TileStore): void {
    this.sky.fill(0);
    this.block.fill(0);
    const skyQ: number[] = [];
    const blockQ: number[] = [];

    // columnar sky light
    for (let x = 0; x < WORLD_W; x++) {
      for (let y = 0; y < WORLD_H; y++) {
        if (isOpaque(store.getTile(x, y))) break;
        this.sky[x + y * WORLD_W] = 15;
        skyQ.push(x + y * WORLD_W);
      }
    }
    // emissive seeds
    for (let i = 0; i < SIZE; i++) {
      const e = emissive(store.tiles[i]);
      if (e > 0) {
        this.block[i] = e;
        blockQ.push(i);
      }
    }
    this.bfs(store, this.sky, skyQ);
    this.bfs(store, this.block, blockQ);
    store.lightDirty = false;
  }

  private bfs(store: TileStore, grid: Uint8Array, queue: number[]): void {
    let head = 0;
    while (head < queue.length) {
      const i = queue[head++];
      const level = grid[i];
      if (level <= 1) continue;
      const x = i % WORLD_W;
      const y = (i / WORLD_W) | 0;
      const next = level - 1;
      const tryCell = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= WORLD_W || ny >= WORLD_H) return;
        if (isOpaque(store.getTile(nx, ny))) return;
        const ni = nx + ny * WORLD_W;
        if (grid[ni] < next) {
          grid[ni] = next;
          queue.push(ni);
        }
      };
      tryCell(x + 1, y);
      tryCell(x - 1, y);
      tryCell(x, y + 1);
      tryCell(x, y - 1);
    }
  }

  /** combined visible light 0..1 for rendering, given the day factor */
  brightness(x: number, y: number, dayFactor: number): number {
    const l = Math.max((this.skyAt(x, y) / 15) * dayFactor, this.blockAt(x, y) / 15);
    return 0.06 + 0.94 * Math.pow(l, 1.25);
  }
}
