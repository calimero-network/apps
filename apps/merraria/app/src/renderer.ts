// Canvas2D renderer: camera-following tile window with per-tile lighting,
// sky gradient + sun/moon, remote players, dig cracks, tile cursor.

import { LightGrid } from "./engine/lighting";
import { PLAYER_H, PLAYER_HALF_W } from "./engine/physics";
import { AIR, tileDef, TORCH, WATER } from "./engine/tiles";
import { hash2 } from "./engine/terrain";
import { TileStore, WORLD_H, WORLD_W } from "./engine/world";
import { celestialPos, skyGradient } from "./engine/sim";

export const TILE_PX = 18;

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

function shade(color: number, mul: number): string {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * mul));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * mul));
  const b = Math.min(255, Math.round((color & 0xff) * mul));
  return `rgb(${r},${g},${b})`;
}

function playerColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return `hsl(${((h % 360) + 360) % 360}, 65%, 55%)`;
}

export interface RemoteDraw {
  id: string;
  name: string;
  x: number;
  y: number;
  dir: number;
}

export class GameRenderer {
  private ctx: CanvasRenderingContext2D;
  camX = 0;
  camY = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  /** center the camera on (x, y) in tile coords, clamped to world bounds */
  follow(x: number, y: number): void {
    const vw = this.canvas.width / TILE_PX;
    const vh = this.canvas.height / TILE_PX;
    this.camX = Math.max(0, Math.min(WORLD_W - vw, x - vw / 2));
    this.camY = Math.max(0, Math.min(WORLD_H - vh, y - vh / 2));
  }

  screenToTile(sx: number, sy: number): { x: number; y: number } {
    return {
      x: Math.floor(this.camX + sx / TILE_PX),
      y: Math.floor(this.camY + sy / TILE_PX),
    };
  }

  render(
    store: TileStore,
    light: LightGrid,
    dayFactor: number,
    elapsed: number,
    me: { x: number; y: number; facing: number; name: string },
    remotes: RemoteDraw[],
    cursor: { x: number; y: number; progress: number } | null,
  ): void {
    const { ctx, canvas } = this;
    const w = canvas.width,
      h = canvas.height;

    // sky
    const [top, bottom] = skyGradient(elapsed);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // sun / moon
    const cel = celestialPos(elapsed);
    ctx.beginPath();
    ctx.arc(cel.x * w, 40 + cel.y * (h * 0.4), 22, 0, Math.PI * 2);
    ctx.fillStyle = cel.isSun ? "#ffe9a8" : "#e8ecf3";
    ctx.fill();

    // visible tile window
    const x0 = Math.floor(this.camX),
      x1 = Math.min(WORLD_W - 1, Math.ceil(this.camX + w / TILE_PX));
    const y0 = Math.floor(this.camY),
      y1 = Math.min(WORLD_H - 1, Math.ceil(this.camY + h / TILE_PX));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const id = store.getTile(x, y);
        if (id === AIR) continue;
        const def = tileDef(id);
        const b = light.brightness(x, y, dayFactor);
        // subtle per-tile texture from a position hash
        const tex = 0.92 + hash2(7, x, y) * 0.16;
        const px = (x - this.camX) * TILE_PX;
        const py = (y - this.camY) * TILE_PX;
        if (id === WATER) {
          ctx.fillStyle = shade(def.color, b);
          ctx.globalAlpha = 0.72;
          ctx.fillRect(px, py + TILE_PX * 0.15, TILE_PX + 1, TILE_PX * 0.85 + 1);
          ctx.globalAlpha = 1;
          continue;
        }
        if (id === TORCH) {
          ctx.fillStyle = "#6b5233";
          ctx.fillRect(px + TILE_PX * 0.42, py + TILE_PX * 0.35, TILE_PX * 0.16, TILE_PX * 0.65);
          ctx.fillStyle = hex(def.color);
          ctx.beginPath();
          ctx.arc(px + TILE_PX / 2, py + TILE_PX * 0.28, TILE_PX * 0.22, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.fillStyle = shade(def.color, b * tex);
        ctx.fillRect(px, py, TILE_PX + 1, TILE_PX + 1);
      }
    }

    // dig crack overlay
    if (cursor && cursor.progress > 0) {
      const px = (cursor.x - this.camX) * TILE_PX;
      const py = (cursor.y - this.camY) * TILE_PX;
      ctx.fillStyle = `rgba(0,0,0,${0.15 + cursor.progress * 0.5})`;
      ctx.fillRect(px, py, TILE_PX, TILE_PX);
    }
    // tile cursor outline
    if (cursor) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        (cursor.x - this.camX) * TILE_PX + 1,
        (cursor.y - this.camY) * TILE_PX + 1,
        TILE_PX - 2,
        TILE_PX - 2,
      );
    }

    // players
    const drawPlayer = (
      x: number,
      y: number,
      facing: number,
      name: string,
      color: string,
      isMe: boolean,
    ) => {
      const px = (x - this.camX) * TILE_PX;
      const py = (y - this.camY) * TILE_PX;
      const bw = PLAYER_HALF_W * 2 * TILE_PX;
      const bh = PLAYER_H * TILE_PX;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(px - bw / 2, py - bh, bw, bh, 4);
      ctx.fill();
      // face dot showing direction
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(px + facing * bw * 0.2, py - bh * 0.78, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "bold 12px system-ui";
      ctx.textAlign = "center";
      ctx.fillStyle = isMe ? "#fff" : "#ffe9a8";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 3;
      ctx.strokeText(name, px, py - bh - 6);
      ctx.fillText(name, px, py - bh - 6);
    };
    for (const r of remotes) drawPlayer(r.x, r.y, r.dir, r.name, playerColor(r.id), false);
    drawPlayer(me.x, me.y, me.facing, me.name, "#4f8cff", true);
  }

  /** whole-world minimap onto a small canvas (1px per 2 tiles) */
  drawMinimap(target: HTMLCanvasElement, store: TileStore, me: { x: number; y: number }): void {
    const ctx = target.getContext("2d")!;
    const sx = 2;
    target.width = WORLD_W / sx;
    target.height = WORLD_H / sx;
    ctx.fillStyle = "#0b0e14";
    ctx.fillRect(0, 0, target.width, target.height);
    for (let y = 0; y < WORLD_H; y += sx) {
      for (let x = 0; x < WORLD_W; x += sx) {
        const id = store.getTile(x, y);
        if (id === AIR) continue;
        ctx.fillStyle = hex(tileDef(id).color);
        ctx.fillRect(x / sx, y / sx, 1, 1);
      }
    }
    ctx.fillStyle = "#ff5555";
    ctx.fillRect(me.x / sx - 1, me.y / sx - 1, 3, 3);
  }
}
