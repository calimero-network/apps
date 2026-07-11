// DOM HUD: hotbar with inventory counts, debug overlay, player list, toasts,
// minimap, connect screen. Twin of mero-blocks' hud with an mt- prefix.

import { HOTBAR, tileDef } from "../engine/tiles";
import { Inventory } from "../engine/mining";

const css = `
#mt-hud { position: fixed; inset: 0; pointer-events: none; color: #fff; z-index: 10;
  font-family: system-ui, -apple-system, sans-serif; }
#mt-hotbar { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 5px; }
.mt-slot { width: 46px; height: 50px; border: 2px solid rgba(255,255,255,0.35);
  border-radius: 6px; background: rgba(0,0,0,0.35); display: flex; align-items: center;
  justify-content: center; flex-direction: column; font-size: 9px; position: relative; }
.mt-slot.sel { border-color: #fff; background: rgba(255,255,255,0.18); }
.mt-swatch { width: 22px; height: 22px; border-radius: 3px; margin-bottom: 2px; }
.mt-count { position: absolute; top: 2px; right: 4px; font-size: 10px; font-weight: 700; }
#mt-debug { position: absolute; top: 10px; left: 10px; font: 11px/1.5 monospace;
  background: rgba(0,0,0,0.45); padding: 6px 10px; border-radius: 6px; white-space: pre; }
#mt-players { position: absolute; top: 10px; right: 10px; font: 12px/1.6 system-ui;
  background: rgba(0,0,0,0.45); padding: 6px 12px; border-radius: 6px; min-width: 120px; }
#mt-minimap { position: absolute; bottom: 14px; right: 14px; border: 2px solid rgba(255,255,255,0.3);
  border-radius: 4px; image-rendering: pixelated; opacity: 0.9; }
#mt-toasts { position: absolute; bottom: 84px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 4px; align-items: center; }
.mt-toast { background: rgba(0,0,0,0.65); padding: 5px 14px; border-radius: 14px;
  font-size: 13px; animation: mtfade 4s forwards; }
@keyframes mtfade { 0%,80% { opacity: 1; } 100% { opacity: 0; } }
#mt-connect { position: fixed; inset: 0; display: flex; align-items: center;
  justify-content: center; background: linear-gradient(160deg, #0b0e14, #1c2a1e);
  z-index: 20; pointer-events: auto; }
.mt-card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 14px; padding: 34px 40px; width: 360px; color: #fff; text-align: center; }
.mt-card h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: 1px; }
.mt-card p { color: #9fc3a8; font-size: 13px; margin: 0 0 22px; }
.mt-card label { display: block; text-align: left; font-size: 12px; color: #9fc3a8; margin: 10px 0 4px; }
.mt-card input { width: 100%; box-sizing: border-box; padding: 9px 10px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: #fff; }
.mt-btn { width: 100%; margin-top: 14px; padding: 11px; border-radius: 8px; border: none;
  font-size: 15px; font-weight: 600; cursor: pointer; }
.mt-btn.primary { background: #4faf5c; color: #fff; }
.mt-btn.ghost { background: rgba(255,255,255,0.1); color: #fff; }
#mt-hint { position: absolute; bottom: 74px; left: 50%; transform: translateX(-50%);
  font-size: 12px; color: rgba(255,255,255,0.75); text-shadow: 0 0 3px #000; }
`;

export interface ConnectChoice {
  mode: "offline" | "online";
  name: string;
  seed: number;
}

export class Hud {
  root: HTMLElement;
  minimap!: HTMLCanvasElement;
  private debugEl!: HTMLElement;
  private playersEl!: HTMLElement;
  private toastsEl!: HTMLElement;
  private slots: HTMLElement[] = [];
  private counts: HTMLElement[] = [];

  constructor(parent: HTMLElement) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    this.root = document.createElement("div");
    this.root.id = "mt-hud";
    parent.appendChild(this.root);
  }

  showGameHud(): void {
    this.root.innerHTML = `
      <div id="mt-hotbar" data-testid="hotbar"></div>
      <div id="mt-debug" data-testid="debug"></div>
      <div id="mt-players" data-testid="players"></div>
      <canvas id="mt-minimap" data-testid="minimap"></canvas>
      <div id="mt-toasts"></div>
      <div id="mt-hint">A/D move, Space jump — hold LMB dig, RMB place, 1-9 tiles</div>
    `;
    this.debugEl = this.root.querySelector("#mt-debug")!;
    this.playersEl = this.root.querySelector("#mt-players")!;
    this.toastsEl = this.root.querySelector("#mt-toasts")!;
    this.minimap = this.root.querySelector("#mt-minimap")!;
    const hotbar = this.root.querySelector("#mt-hotbar")!;
    this.slots = HOTBAR.map((id, i) => {
      const def = tileDef(id);
      const slot = document.createElement("div");
      slot.className = "mt-slot";
      slot.dataset.testid = `slot-${i}`;
      slot.innerHTML = `
        <div class="mt-count" data-testid="count-${i}">0</div>
        <div class="mt-swatch" style="background: #${def.color.toString(16).padStart(6, "0")}"></div>${def.name}`;
      hotbar.appendChild(slot);
      return slot;
    });
    this.counts = this.slots.map((s) => s.querySelector(".mt-count")!);
    this.setHotbarSel(0);
  }

  setHotbarSel(index: number): void {
    this.slots.forEach((s, i) => s.classList.toggle("sel", i === index));
  }

  updateInventory(inv: Inventory): void {
    HOTBAR.forEach((id, i) => {
      if (this.counts[i]) this.counts[i].textContent = String(inv.count(id));
    });
  }

  setDebug(text: string): void {
    if (this.debugEl) this.debugEl.textContent = text;
  }

  setPlayers(me: string, others: { name: string }[]): void {
    if (!this.playersEl) return;
    const rows = [`<b>${escapeHtml(me)} (you)</b>`, ...others.map((p) => escapeHtml(p.name))];
    this.playersEl.innerHTML = rows.join("<br>");
  }

  toast(msg: string): void {
    if (!this.toastsEl) return;
    const el = document.createElement("div");
    el.className = "mt-toast";
    el.textContent = msg;
    this.toastsEl.appendChild(el);
    setTimeout(() => el.remove(), 4100);
  }

  connectScreen(canConnect: boolean, defaults: { name: string; seed: number }): Promise<ConnectChoice> {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.id = "mt-connect";
      overlay.innerHTML = `
        <div class="mt-card">
          <h1>merraria</h1>
          <p>2D multiplayer mining sandbox on Calimero</p>
          <label>player name</label>
          <input id="mt-name" data-testid="name-input" value="${escapeHtml(defaults.name)}" maxlength="16" />
          <label>world seed (offline)</label>
          <input id="mt-seed" data-testid="seed-input" value="${defaults.seed}" />
          ${canConnect ? `<button class="mt-btn primary" data-testid="connect-btn">Enter shared world</button>` : ""}
          <button class="mt-btn ghost" data-testid="offline-btn">Play offline</button>
        </div>
      `;
      this.root.appendChild(overlay);
      const done = (mode: "offline" | "online") => {
        const name = (overlay.querySelector<HTMLInputElement>("#mt-name")!.value || "Player").trim();
        const seed =
          Math.abs(Math.floor(Number(overlay.querySelector<HTMLInputElement>("#mt-seed")!.value))) ||
          defaults.seed;
        overlay.remove();
        resolve({ mode, name, seed });
      };
      overlay
        .querySelector("[data-testid=offline-btn]")!
        .addEventListener("click", () => done("offline"));
      overlay
        .querySelector("[data-testid=connect-btn]")
        ?.addEventListener("click", () => done("online"));
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
