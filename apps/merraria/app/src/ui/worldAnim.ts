// Animated merraria world for the landing page: the real terrain generator,
// tile sprites, lighting and day/night cycle, slowly panning across a fixed
// demo world with a couple of wandering miners. Purely decorative — nothing
// here touches the network or the player's saved worlds.

import { LightGrid } from "../engine/lighting";
import { dayFactor, celestialPos, skyGradient } from "../engine/sim";
import { generateWorld, hash2 } from "../engine/terrain";
import { AIR, isSolid, WATER } from "../engine/tiles";
import { TileStore, WORLD_H, WORLD_W } from "../engine/world";
import { TILE_PX, TileAtlas, VARIANTS } from "../renderer";

const DEMO_SEED = 1337;
const TILE = 14; // a touch smaller than in-game so more world fits the hero
const PAN_TILES_PER_SEC = 1.6;
const TIME_SCALE = 15; // 600s day/night cycle plays in 40s

interface Bot {
  offset: number; // x offset from the camera's left edge, in tiles
  speed: number;
  color: string;
}

export class WorldAnim {
  private ctx: CanvasRenderingContext2D | null;
  private store = new TileStore();
  private light = new LightGrid();
  private atlas: TileAtlas;
  private raf = 0;
  private t0 = performance.now();
  private camY = 0;
  private bots: Bot[] = [
    { offset: 12, speed: 2.1, color: "#4f8cff" },
    { offset: 30, speed: -1.7, color: "#e8c34a" },
    { offset: 48, speed: 1.3, color: "#c85fd0" },
  ];
  private onResize = () => this.resize();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
    this.atlas = new TileAtlas();
    generateWorld(this.store, DEMO_SEED);
    this.light.recompute(this.store);
    this.camY = this.surfaceAt(0) - 8;
    this.resize();
    window.addEventListener("resize", this.onResize);
  }

  private resize(): void {
    this.canvas.width = this.canvas.clientWidth || window.innerWidth;
    this.canvas.height = this.canvas.clientHeight || window.innerHeight;
  }

  start(): void {
    const frame = (now: number) => {
      this.draw(now);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
  }

  /** world x wraps so the pan loops forever */
  private tile(x: number, y: number): number {
    const wx = ((Math.floor(x) % WORLD_W) + WORLD_W) % WORLD_W;
    if (y < 0 || y >= WORLD_H) return AIR;
    return this.store.getTile(wx, y);
  }

  private surfaceAt(x: number): number {
    for (let y = 0; y < WORLD_H; y++) {
      const t = this.tile(x, y);
      if (t === WATER || isSolid(t)) return y;
    }
    return WORLD_H - 20;
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    const elapsed = ((now - this.t0) / 1000) * TIME_SCALE;
    const camX = ((now - this.t0) / 1000) * PAN_TILES_PER_SEC;
    const df = dayFactor(elapsed);

    // sky + sun/moon
    const [top, bottom] = skyGradient(elapsed);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    const cel = celestialPos(elapsed);
    ctx.beginPath();
    ctx.arc(cel.x * w, 40 + cel.y * (h * 0.35), 20, 0, Math.PI * 2);
    ctx.fillStyle = cel.isSun ? "#ffe9a8" : "#e8ecf3";
    ctx.fill();

    // ease the camera toward the terrain under its center
    const targetY = this.surfaceAt(camX + w / TILE / 2) - h / TILE / 2.6;
    this.camY += (targetY - this.camY) * 0.02;

    const cols = Math.ceil(w / TILE) + 1;
    const rows = Math.ceil(h / TILE) + 1;
    const x0 = Math.floor(camX);
    const y0 = Math.floor(this.camY);
    const fx = (camX - x0) * TILE;
    const fy = (this.camY - y0) * TILE;

    for (let ry = 0; ry <= rows; ry++) {
      const y = y0 + ry;
      for (let rx = 0; rx <= cols; rx++) {
        const x = x0 + rx;
        const id = this.tile(x, y);
        const wx = ((x % WORLD_W) + WORLD_W) % WORLD_W;
        const px = rx * TILE - fx;
        const py = ry * TILE - fy;
        // same occlusion rule as the game renderer: unlit cave air must not
        // show the sky gradient through the hillside
        const occl =
          y < 0 || y >= WORLD_H
            ? 0
            : 1 - Math.max(this.light.skyAt(wx, y), this.light.blockAt(wx, y)) / 15;
        if (id === AIR) {
          if (occl > 0.02) {
            ctx.fillStyle = `rgba(6,8,14,${(occl * 0.96).toFixed(3)})`;
            ctx.fillRect(px, py, TILE + 1, TILE + 1);
          }
          continue;
        }
        const b = y < 0 || y >= WORLD_H ? 1 : this.light.brightness(wx, y, df);
        if (id === WATER) {
          ctx.fillStyle = `rgba(63,118,228,${(0.72 * Math.max(0.35, b)).toFixed(3)})`;
          ctx.fillRect(px, py + TILE * 0.15, TILE + 1, TILE * 0.85 + 1);
          continue;
        }
        const variant = (hash2(7, wx, y) * VARIANTS) | 0;
        ctx.drawImage(
          this.atlas.canvas,
          variant * TILE_PX,
          id * TILE_PX,
          TILE_PX,
          TILE_PX,
          px,
          py,
          TILE + 1,
          TILE + 1,
        );
        const dark = 1 - b;
        if (dark > 0.02) {
          ctx.fillStyle = `rgba(4,6,12,${dark.toFixed(3)})`;
          ctx.fillRect(px, py, TILE + 1, TILE + 1);
        }
      }
    }

    // wandering miners on the surface
    const t = (now - this.t0) / 1000;
    for (const bot of this.bots) {
      const span = cols * 0.9;
      const local = (((bot.offset + t * bot.speed) % span) + span) % span;
      const bx = camX + local + 0.5;
      const by = this.surfaceAt(bx);
      const px = (bx - camX) * TILE - fx;
      const py = (by - this.camY) * TILE - fy;
      ctx.fillStyle = bot.color;
      ctx.beginPath();
      ctx.roundRect(px - TILE * 0.28, py - TILE * 1.5, TILE * 0.56, TILE * 1.5, 3);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(px + Math.sign(bot.speed) * TILE * 0.12, py - TILE * 1.2, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
