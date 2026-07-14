// In-game overlays, all keyboard-driven so a MacBook trackpad never needs a
// right-click: Esc/O toggle the Minecraft-style pause menu (game menu →
// options subscreen with FOV + sensitivity), M toggles the live world map.

import { AIR, blockDef, HOTBAR } from "../engine/blocks";
import { WORLD_SX, WORLD_SY, WORLD_SZ, WorldStore } from "../engine/world";

const css = `
.mbo-overlay { position: fixed; inset: 0; z-index: 15; display: flex; align-items: center;
  justify-content: center; background: rgba(5,8,12,0.62); color: #fff;
  font-family: system-ui, -apple-system, sans-serif; }
.mbo-panel { background: #131a26; border: 1px solid rgba(255,255,255,0.14); border-radius: 14px;
  padding: 22px 26px; min-width: 320px; max-width: 92vw; max-height: 88vh; overflow-y: auto; }
.mbo-panel h3 { margin: 0 0 14px; font-size: 16px; }
.mbo-keys { display: grid; grid-template-columns: auto 1fr; gap: 7px 14px; font-size: 13px;
  color: #b8c6d6; margin-bottom: 18px; align-items: center; }
.mbo-keys kbd { background: rgba(255,255,255,0.12); border-radius: 4px; padding: 2px 8px;
  font-size: 11px; font-family: monospace; justify-self: start; white-space: nowrap; }
.mbo-row { display: flex; align-items: center; gap: 12px; margin: 14px 0; font-size: 13px;
  color: #b8c6d6; }
.mbo-row input[type=range] { flex: 1; }
.mbo-btn { width: 100%; margin-top: 10px; padding: 11px; border-radius: 9px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer; }
.mbo-btn.primary { background: #4f8cff; color: #fff; }
.mbo-btn.ghost { background: rgba(255,255,255,0.1); color: #fff; }
.mbo-btn.danger { background: rgba(214,86,86,0.22); color: #ffb3b3; }
.mbo-btn:hover { filter: brightness(1.15); }
.mbo-title { text-align: center; }
.mbo-map-wrap { position: relative; line-height: 0; border: 1px solid rgba(255,255,255,0.18);
  border-radius: 8px; overflow: hidden; }
.mbo-map-wrap canvas { display: block; }
.mbo-map-wrap canvas + canvas { position: absolute; inset: 0; }
.mbo-note { font-size: 11px; color: #8fa3ba; margin-top: 10px; }
`;

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

const SENSITIVITY_KEY = "mb-sensitivity";
const FOV_KEY = "mb-fov";
export const FOV_DEFAULT = 75;
const FOV_MIN = 60;
const FOV_MAX = 110;

export interface PauseCallbacks {
  onLeave: () => void;
  /** mint a copyable invite for the current world (online sessions only) */
  onInvite?: () => Promise<string>;
  /** live-apply the FOV slider to the camera */
  onFovChange?: (fov: number) => void;
}

/**
 * Minecraft-style pause menu. Esc (or O) opens the game menu — Back to game /
 * Options… / invite / leave — and Options… swaps the panel to the settings
 * screen (FOV, mouse sensitivity, controls reference) with a Done button back.
 */
export class PauseMenu {
  open = false;
  private root: HTMLElement;
  private sensitivity: number;
  private fov: number;
  private screen: "main" | "options" = "main";

  constructor(
    private parent: HTMLElement,
    private callbacks: PauseCallbacks,
  ) {
    injectStyle();
    this.root = document.createElement("div");
    this.root.className = "mbo-overlay";
    this.root.dataset.testid = "options-overlay";
    const stored = Number(localStorage.getItem(SENSITIVITY_KEY));
    this.sensitivity = stored >= 0.4 && stored <= 2 ? stored : 1;
    const fov = Number(localStorage.getItem(FOV_KEY));
    this.fov = fov >= FOV_MIN && fov <= FOV_MAX ? fov : FOV_DEFAULT;
  }

  /** mouse-look multiplier chosen by the player (0.4×–2×) */
  getSensitivity(): number {
    return this.sensitivity;
  }

  /** field of view in degrees, restored from the last session */
  getFov(): number {
    return this.fov;
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.remove();
  }

  private show(): void {
    this.open = true;
    this.screen = "main";
    this.render();
    this.parent.appendChild(this.root);
  }

  private render(): void {
    if (this.screen === "main") this.renderMain();
    else this.renderOptions();
  }

  private renderMain(): void {
    this.root.innerHTML = `
      <div class="mbo-panel">
        <h3 class="mbo-title">Game menu</h3>
        <button class="mbo-btn primary" data-testid="resume-btn">Back to game</button>
        <button class="mbo-btn ghost" data-testid="options-btn">Options…</button>
        ${this.callbacks.onInvite ? `<button class="mbo-btn ghost" data-testid="invite-btn">Copy world invite</button>` : ""}
        <button class="mbo-btn danger" data-testid="leave-btn">Save &amp; leave world</button>
      </div>`;
    this.root.querySelector("[data-testid=resume-btn]")!.addEventListener("click", () => this.hide());
    this.root.querySelector("[data-testid=options-btn]")!.addEventListener("click", () => {
      this.screen = "options";
      this.render();
    });
    this.root.querySelector("[data-testid=leave-btn]")!.addEventListener("click", () =>
      this.callbacks.onLeave(),
    );
    const inviteBtn = this.root.querySelector<HTMLButtonElement>("[data-testid=invite-btn]");
    if (inviteBtn && this.callbacks.onInvite) {
      inviteBtn.addEventListener("click", async () => {
        inviteBtn.disabled = true;
        inviteBtn.textContent = "Creating invite…";
        try {
          const code = await this.callbacks.onInvite!();
          await navigator.clipboard.writeText(code);
          inviteBtn.textContent = "Invite copied!";
        } catch {
          inviteBtn.textContent = "Invite failed — try again";
        } finally {
          // brief confirmation, then back to normal — mint as many as you like
          setTimeout(() => {
            inviteBtn.textContent = "Copy world invite";
            inviteBtn.disabled = false;
          }, 2500);
        }
      });
    }
  }

  private renderOptions(): void {
    this.root.innerHTML = `
      <div class="mbo-panel">
        <h3 class="mbo-title">Options</h3>
        <div class="mbo-row">
          <span>FOV</span>
          <input type="range" min="${FOV_MIN}" max="${FOV_MAX}" step="1" value="${this.fov}"
            data-testid="fov-slider" />
          <span data-testid="fov-value">${fovLabel(this.fov)}</span>
        </div>
        <div class="mbo-row">
          <span>mouse sensitivity</span>
          <input type="range" min="0.4" max="2" step="0.1" value="${this.sensitivity}"
            data-testid="sensitivity-slider" />
          <span data-testid="sensitivity-value">${this.sensitivity.toFixed(1)}×</span>
        </div>
        <div class="mbo-keys">
          <kbd>WASD</kbd><span>move</span>
          <kbd>Space</kbd><span>jump</span>
          <kbd>LMB or Q</kbd><span>break block (hold)</span>
          <kbd>RMB or E</kbd><span>place block (hold)</span>
          <kbd>1–9 / wheel</kbd><span>pick block</span>
          <kbd>M</kbd><span>world map</span>
          <kbd>Esc / O</kbd><span>game menu</span>
        </div>
        <button class="mbo-btn primary" data-testid="options-done-btn">Done</button>
        <div class="mbo-note">On a trackpad you never need mouse buttons: hold Q to break and
        E to place while looking at a block.</div>
      </div>`;
    const fovSlider = this.root.querySelector<HTMLInputElement>("[data-testid=fov-slider]")!;
    const fovValue = this.root.querySelector<HTMLElement>("[data-testid=fov-value]")!;
    fovSlider.addEventListener("input", () => {
      this.fov = Number(fovSlider.value);
      fovValue.textContent = fovLabel(this.fov);
      localStorage.setItem(FOV_KEY, fovSlider.value);
      this.callbacks.onFovChange?.(this.fov); // live preview behind the menu
    });
    const slider = this.root.querySelector<HTMLInputElement>("[data-testid=sensitivity-slider]")!;
    const value = this.root.querySelector<HTMLElement>("[data-testid=sensitivity-value]")!;
    slider.addEventListener("input", () => {
      this.sensitivity = Number(slider.value);
      value.textContent = `${this.sensitivity.toFixed(1)}×`;
      localStorage.setItem(SENSITIVITY_KEY, slider.value);
    });
    this.root.querySelector("[data-testid=options-done-btn]")!.addEventListener("click", () => {
      this.screen = "main";
      this.render();
    });
  }
}

/** Minecraft names the ends of its FOV range — do the same */
function fovLabel(fov: number): string {
  if (fov <= FOV_MIN) return "Zoomed";
  if (fov >= FOV_MAX) return "Quake Pro";
  if (fov === FOV_DEFAULT) return "Normal";
  return `${fov}°`;
}

export interface MapMarker {
  x: number;
  z: number;
  yaw: number;
  name: string;
  /** hotbar index of the held block (drawn as a swatch next to the name) */
  sel?: number;
}

const MAP_SCALE = 4; // 128×128 columns → 512×512 px
const TERRAIN_REDRAW_MS = 500;

export class WorldMap {
  open = false;
  private root: HTMLElement;
  private terrain!: HTMLCanvasElement;
  private markers!: HTMLCanvasElement;
  private terrainClock = Infinity; // force a redraw on first update after open

  constructor(
    private parent: HTMLElement,
    private world: WorldStore,
  ) {
    injectStyle();
    this.root = document.createElement("div");
    this.root.className = "mbo-overlay";
    this.root.dataset.testid = "map-overlay";
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.remove();
  }

  private show(): void {
    this.open = true;
    this.terrainClock = Infinity;
    const size = WORLD_SX * MAP_SCALE;
    this.root.innerHTML = `
      <div class="mbo-panel">
        <h3>World map</h3>
        <div class="mbo-map-wrap">
          <canvas width="${size}" height="${size}" style="width:min(70vh,80vw);height:min(70vh,80vw)"></canvas>
          <canvas width="${size}" height="${size}" style="width:min(70vh,80vw);height:min(70vh,80vw)"
            data-testid="map-players"></canvas>
        </div>
        <div class="mbo-note">Live positions of everyone in this world · refreshes every 500&nbsp;ms ·
        press M to close</div>
      </div>`;
    const canvases = this.root.querySelectorAll("canvas");
    this.terrain = canvases[0] as HTMLCanvasElement;
    this.markers = canvases[1] as HTMLCanvasElement;
    this.parent.appendChild(this.root);
  }

  /** call every frame while the game runs; cheap when closed */
  update(dtMs: number, me: MapMarker, others: MapMarker[]): void {
    if (!this.open) return;
    this.terrainClock += dtMs;
    if (this.terrainClock >= TERRAIN_REDRAW_MS) {
      this.terrainClock = 0;
      this.drawTerrain();
    }
    this.drawMarkers(me, others);
  }

  /** top-down color of the highest non-air block per column, shaded by height */
  private drawTerrain(): void {
    const ctx = this.terrain.getContext("2d")!;
    for (let z = 0; z < WORLD_SZ; z++) {
      for (let x = 0; x < WORLD_SX; x++) {
        let color = "#0b0e14";
        for (let y = WORLD_SY - 1; y >= 0; y--) {
          const b = this.world.getBlock(x, y, z);
          if (b === AIR) continue;
          const [r, g, bl] = blockDef(b).colors[0];
          const shade = 0.55 + 0.45 * (y / (WORLD_SY - 1));
          color = `rgb(${Math.round(r * 255 * shade)},${Math.round(g * 255 * shade)},${Math.round(bl * 255 * shade)})`;
          break;
        }
        ctx.fillStyle = color;
        ctx.fillRect(x * MAP_SCALE, z * MAP_SCALE, MAP_SCALE, MAP_SCALE);
      }
    }
  }

  private drawMarkers(me: MapMarker, others: MapMarker[]): void {
    const ctx = this.markers.getContext("2d")!;
    ctx.clearRect(0, 0, this.markers.width, this.markers.height);
    for (const p of others) this.drawMarker(ctx, p, "#ffffff");
    this.drawMarker(ctx, me, "#58c56b"); // draw self last, on top
  }

  private drawMarker(ctx: CanvasRenderingContext2D, p: MapMarker, color: string): void {
    const mx = p.x * MAP_SCALE;
    const mz = p.z * MAP_SCALE;
    // forward in world space is (-sin yaw, -cos yaw) — same axes on the map
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    ctx.save();
    ctx.translate(mx, mz);
    ctx.rotate(Math.atan2(fz, fx) + Math.PI / 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // name + held-block swatch
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    const label = p.name;
    const w = ctx.measureText(label).width;
    ctx.fillRect(mx - w / 2 - 4, mz + 11, w + 8, 18);
    ctx.fillStyle = color;
    ctx.fillText(label, mx, mz + 25);
    if (p.sel !== undefined && HOTBAR[p.sel] !== undefined) {
      const [r, g, b] = blockDef(HOTBAR[p.sel]).colors[0];
      ctx.fillStyle = `rgb(${r * 255},${g * 255},${b * 255})`;
      ctx.fillRect(mx + w / 2 + 6, mz + 13, 12, 12);
    }
  }
}
