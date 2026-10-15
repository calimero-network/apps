// Minecraft-title-screen style backdrop for the landing page: a real
// generated world, rendered with a slowly spinning camera and blurred by CSS.
// Fully self-contained — it owns its canvas, worker and render loop and is
// destroyed the moment the player enters the game (which regenerates its own
// world).
//
// ⚠️ THE WORLD IS BUILT IN A WORKER. Generating, lighting and meshing all 256
// chunks is seconds of CPU (2.4–3.3 s on a 4-core dev box, far more on a busy
// CI runner with software WebGL). It used to run in one requestAnimationFrame
// callback on the main thread, which starts exactly when the launcher's
// "Connect a node" button appears — so the page was frozen at the one moment a
// player reaches for it: their click did nothing for seconds, and the journey's
// `click()` on it timed out (CI, 15 s). The main thread now only uploads the
// finished meshes and draws.

import { dayFactor, skyColor } from "../engine/sim";
import { GameRenderer } from "../renderer";
import type { PanoramaScene } from "./panoramaScene";

const PANORAMA_SEED = 1337;
const YAW_SPEED = 0.03; // rad/s — slow Minecraft-style spin
const DAY_TIMELAPSE = 40; // sky drifts through the cycle at 40× speed

export class Panorama {
  private canvas: HTMLCanvasElement;
  private worker: Worker | null = null;
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

    // A backdrop is decoration: with no worker (or a failed one) the launcher
    // simply has no panorama, and never pays for it on the main thread.
    if (typeof Worker === "undefined") return;
    try {
      this.worker = new Worker(new URL("./panorama.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return;
    }
    this.worker.onmessage = (e: MessageEvent<PanoramaScene>) => {
      this.stopWorker();
      if (!this.destroyed) this.start(e.data);
    };
    this.worker.onerror = () => this.stopWorker();
    this.worker.postMessage({ seed: PANORAMA_SEED });
  }

  private stopWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private start(scene: PanoramaScene): void {
    const renderer = new GameRenderer(this.canvas);
    for (const c of scene.chunks) renderer.updateChunk(c.key, c.opaque, c.translucent);

    const eye = scene.eye;
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
    this.stopWorker();
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
  }
}
