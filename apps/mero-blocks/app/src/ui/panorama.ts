// Minecraft-title-screen style backdrop for the landing page: a real
// generated world, rendered with a slowly spinning camera and blurred by CSS.
// Fully self-contained — it owns its canvas and render loop and is destroyed
// the moment the player enters the game (which regenerates its own world).

import { LightGrid } from "../engine/lighting";
import { buildChunkMesh } from "../engine/mesher";
import { dayFactor, skyColor } from "../engine/sim";
import { generateWorld, spawnPoint } from "../engine/terrain";
import { WorldStore, WORLD_CX, WORLD_CY, WORLD_CZ, chunkKey } from "../engine/world";
import { GameRenderer } from "../renderer";

const PANORAMA_SEED = 1337;
const YAW_SPEED = 0.03; // rad/s — slow Minecraft-style spin
const DAY_TIMELAPSE = 40; // sky drifts through the cycle at 40× speed

export class Panorama {
  private canvas: HTMLCanvasElement;
  private raf = 0;
  private destroyed = false;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.dataset.testid = "panorama";
    // scale slightly past the viewport so the blur never shows bright edges
    this.canvas.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;z-index:0;" +
      "filter:blur(7px) brightness(0.85);transform:scale(1.06);pointer-events:none;";
    parent.appendChild(this.canvas);

    // defer the (CPU-heavy) worldgen one frame so the landing UI paints first
    requestAnimationFrame(() => {
      if (!this.destroyed) this.start();
    });
  }

  private start(): void {
    const world = new WorldStore();
    generateWorld(world, PANORAMA_SEED);
    const light = new LightGrid();
    light.recomputeAll(world);

    const renderer = new GameRenderer(this.canvas);
    for (let cx = 0; cx < WORLD_CX; cx++)
      for (let cy = 0; cy < WORLD_CY; cy++)
        for (let cz = 0; cz < WORLD_CZ; cz++) {
          const mesh = buildChunkMesh(world, light, cx, cy, cz);
          renderer.updateChunk(chunkKey(cx, cy, cz), mesh.opaque, mesh.translucent);
        }

    const eye = spawnPoint(PANORAMA_SEED);
    const start = performance.now();
    const frame = (now: number): void => {
      if (this.destroyed) return;
      const t = (now - start) / 1000;
      renderer.setCamera(eye.x, eye.y + 6, eye.z, t * YAW_SPEED, -0.12);
      const elapsed = 3000 + t * DAY_TIMELAPSE; // start mid-morning
      renderer.setDay(dayFactor(elapsed), skyColor(elapsed));
      renderer.render();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
  }
}
