// Canvas2D renderer: camera-following tile window with per-tile lighting,
// sky gradient + sun/moon, remote players, dig cracks, tile cursor.

import { LightGrid } from "./engine/lighting";
import { PLAYER_H, PLAYER_HALF_W } from "./engine/physics";
import {
  AIR,
  BEDROCK,
  BRICK,
  DIRT,
  GLASS,
  GRASS,
  LEAVES,
  ORE_COAL,
  ORE_GOLD,
  ORE_IRON,
  PLANK,
  SAND,
  STONE,
  tileDef,
  TILES,
  TORCH,
  WATER,
  WOOD,
} from "./engine/tiles";
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
  action?: string;
}

// ── Procedural tile sprites ──────────────────────────────────────────────────
// Each tile id is baked once into an offscreen atlas as VARIANTS pixel-art
// variants (6×6 texels of 3px). The world picks a variant per position from a
// hash, so terrain looks textured but stays deterministic across clients.

export const VARIANTS = 4;
const TEXEL = 3;
const TEXELS = TILE_PX / TEXEL; // 6

export class TileAtlas {
  canvas: HTMLCanvasElement;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = VARIANTS * TILE_PX;
    this.canvas.height = TILES.length * TILE_PX;
    const ctx = this.canvas.getContext("2d")!;
    for (let id = 0; id < TILES.length; id++) {
      if (!TILES[id] || id === AIR || id === WATER || id === TORCH) continue;
      for (let v = 0; v < VARIANTS; v++) this.bake(ctx, id, v);
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    id: number,
    variant: number,
    px: number,
    py: number,
    size = TILE_PX,
  ): void {
    ctx.drawImage(
      this.canvas,
      variant * TILE_PX,
      id * TILE_PX,
      TILE_PX,
      TILE_PX,
      px,
      py,
      size + 1,
      size + 1,
    );
  }

  private bake(ctx: CanvasRenderingContext2D, id: number, variant: number): void {
    const ox = variant * TILE_PX;
    const oy = id * TILE_PX;
    const base = tileDef(id).color;
    const rnd = (tx: number, ty: number, salt = 0) =>
      hash2(id * 97 + variant * 131 + salt, tx, ty);
    const put = (tx: number, ty: number, style: string) => {
      ctx.fillStyle = style;
      ctx.fillRect(ox + tx * TEXEL, oy + ty * TEXEL, TEXEL, TEXEL);
    };

    for (let ty = 0; ty < TEXELS; ty++) {
      for (let tx = 0; tx < TEXELS; tx++) {
        const n = rnd(tx, ty);
        let color = base;
        let mul = 0.88 + n * 0.24;
        switch (id) {
          case GRASS: {
            // green turf on top of dirt, ragged boundary
            const turf = ty < 2 || (ty === 2 && rnd(tx, ty, 1) < 0.45);
            color = turf ? base : tileDef(DIRT).color;
            if (ty === 0) mul = 1.0 + n * 0.18; // sunlit blade tips
            break;
          }
          case DIRT:
          case SAND:
            if (rnd(tx, ty, 2) < 0.12) mul *= 0.7; // pebbles/speckles
            break;
          case STONE:
          case BEDROCK:
            if (rnd(tx, ty, 2) < 0.18) mul *= 0.75; // darker patches
            break;
          case ORE_COAL:
          case ORE_IRON:
          case ORE_GOLD: {
            // stone matrix with nuggets of the ore color
            const nugget = rnd(tx, ty, 3) < 0.24;
            color = nugget ? base : tileDef(STONE).color;
            if (nugget) mul = 0.95 + n * 0.25;
            break;
          }
          case WOOD: // vertical bark grain
            if (tx % 3 === 0) mul *= 0.72;
            break;
          case LEAVES: // leafy clumps with holes of darker green
            if (rnd(tx, ty, 4) < 0.28) mul *= 0.68;
            else if (rnd(tx, ty, 5) < 0.15) mul = 1.15;
            break;
          case PLANK: // horizontal boards
            if (ty % 3 === 2) mul *= 0.7;
            else if (rnd(tx, ty, 6) < 0.1) mul *= 0.85;
            break;
          case BRICK: {
            // running bond: mortar every 3rd row + offset vertical joints
            const row = (ty / 3) | 0;
            const mortar = ty % 3 === 2 || (tx + row * 2) % 4 === 3;
            if (mortar) {
              color = 0x9a9186;
              mul = 0.9 + n * 0.1;
            }
            break;
          }
          case GLASS: {
            // translucent pane with a diagonal sheen
            ctx.clearRect(ox + tx * TEXEL, oy + ty * TEXEL, TEXEL, TEXEL);
            const sheen = tx === ty || tx === ty + 1;
            const edge = tx === 0 || ty === 0 || tx === TEXELS - 1 || ty === TEXELS - 1;
            ctx.globalAlpha = sheen ? 0.55 : edge ? 0.4 : 0.18;
            put(tx, ty, hex(base));
            ctx.globalAlpha = 1;
            continue;
          }
        }
        put(tx, ty, shade(color, mul));
      }
    }
  }
}

export class GameRenderer {
  private ctx: CanvasRenderingContext2D;
  private atlas: TileAtlas;
  camX = 0;
  camY = 0;
  /** on-screen tile size — TILE_PX scaled by the player's zoom choice */
  private tilePx = TILE_PX;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    this.atlas = new TileAtlas();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /** the 2D stand-in for an FOV slider: zoom out to see more of the world */
  setZoom(zoom: number): void {
    this.tilePx = Math.max(6, Math.round(TILE_PX * zoom));
  }

  resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  /** center the camera on (x, y) in tile coords, clamped to world bounds */
  follow(x: number, y: number): void {
    const vw = this.canvas.width / this.tilePx;
    const vh = this.canvas.height / this.tilePx;
    this.camX = Math.max(0, Math.min(WORLD_W - vw, x - vw / 2));
    this.camY = Math.max(0, Math.min(WORLD_H - vh, y - vh / 2));
  }

  screenToTile(sx: number, sy: number): { x: number; y: number } {
    return {
      x: Math.floor(this.camX + sx / this.tilePx),
      y: Math.floor(this.camY + sy / this.tilePx),
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
      x1 = Math.min(WORLD_W - 1, Math.ceil(this.camX + w / this.tilePx));
    const y0 = Math.floor(this.camY),
      y1 = Math.min(WORLD_H - 1, Math.ceil(this.camY + h / this.tilePx));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const id = store.getTile(x, y);
        const px = (x - this.camX) * this.tilePx;
        const py = (y - this.camY) * this.tilePx;
        // occlusion darkness for see-through cells: unlit cave air/water must
        // not show the sky gradient through the hillside. Uses raw light (not
        // dayFactor) so the open night sky and moon stay untouched.
        const occl = 1 - Math.max(light.skyAt(x, y), light.blockAt(x, y)) / 15;
        if (id === AIR) {
          if (occl > 0.02) {
            ctx.fillStyle = `rgba(6,8,14,${(occl * 0.96).toFixed(3)})`;
            ctx.fillRect(px, py, this.tilePx + 1, this.tilePx + 1);
          }
          continue;
        }
        const def = tileDef(id);
        const b = light.brightness(x, y, dayFactor);
        if (id === WATER) {
          const surface = store.getTile(x, y - 1) !== WATER;
          const top = surface ? this.tilePx * 0.15 : 0;
          ctx.fillStyle = shade(def.color, b);
          ctx.globalAlpha = 0.72;
          ctx.fillRect(px, py + top, this.tilePx + 1, this.tilePx - top + 1);
          if (surface) {
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = shade(0x9fd4ff, b);
            ctx.fillRect(px, py + top, this.tilePx + 1, 2);
          }
          ctx.globalAlpha = 1;
          if (occl > 0.02) {
            ctx.fillStyle = `rgba(6,8,14,${(occl * 0.96).toFixed(3)})`;
            ctx.fillRect(px, py, this.tilePx + 1, this.tilePx + 1);
          }
          continue;
        }
        if (id === TORCH) {
          ctx.fillStyle = "#6b5233";
          ctx.fillRect(px + this.tilePx * 0.42, py + this.tilePx * 0.35, this.tilePx * 0.16, this.tilePx * 0.65);
          ctx.fillStyle = hex(def.color);
          ctx.beginPath();
          ctx.arc(px + this.tilePx / 2, py + this.tilePx * 0.28, this.tilePx * 0.22, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        // textured sprite, then darkness from the light grid on top
        const variant = (hash2(7, x, y) * VARIANTS) | 0;
        this.atlas.draw(ctx, id, variant, px, py, this.tilePx);
        const dark = 1 - b;
        if (dark > 0.02) {
          ctx.fillStyle = `rgba(4,6,12,${dark.toFixed(3)})`;
          ctx.fillRect(px, py, this.tilePx + 1, this.tilePx + 1);
        }
      }
    }

    // dig crack overlay
    if (cursor && cursor.progress > 0) {
      const px = (cursor.x - this.camX) * this.tilePx;
      const py = (cursor.y - this.camY) * this.tilePx;
      ctx.fillStyle = `rgba(0,0,0,${0.15 + cursor.progress * 0.5})`;
      ctx.fillRect(px, py, this.tilePx, this.tilePx);
    }
    // tile cursor outline
    if (cursor) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        (cursor.x - this.camX) * this.tilePx + 1,
        (cursor.y - this.camY) * this.tilePx + 1,
        this.tilePx - 2,
        this.tilePx - 2,
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
      action?: string,
    ) => {
      const px = (x - this.camX) * this.tilePx;
      const py = (y - this.camY) * this.tilePx;
      const bw = PLAYER_HALF_W * 2 * this.tilePx;
      const bh = PLAYER_H * this.tilePx;
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
      // what they're doing, under the name tag
      if (action && action !== "idle") {
        const icon =
          action === "mining" ? "⛏" : action === "building" ? "🧱" : action === "swimming" ? "🌊" : "";
        ctx.font = "10px system-ui";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        const label = icon ? `${icon} ${action}` : action;
        ctx.strokeText(label, px, py - bh - 19);
        ctx.fillText(label, px, py - bh - 19);
      }
    };
    for (const r of remotes) drawPlayer(r.x, r.y, r.dir, r.name, playerColor(r.id), false, r.action);
    drawPlayer(me.x, me.y, me.facing, me.name, "#4f8cff", true);
  }

  /** whole-world minimap onto a small canvas (1px per 2 tiles) */
  drawMinimap(
    target: HTMLCanvasElement,
    store: TileStore,
    me: { x: number; y: number },
    remotes: RemoteDraw[] = [],
  ): void {
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
    // other miners, live — each in their stable per-id color
    for (const r of remotes) {
      ctx.fillStyle = playerColor(r.id);
      ctx.fillRect(r.x / sx - 1, r.y / sx - 1, 3, 3);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(r.x / sx, r.y / sx, 1, 1);
    }
    ctx.fillStyle = "#ff5555";
    ctx.fillRect(me.x / sx - 1, me.y / sx - 1, 3, 3);
  }
}
