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
#mt-hint { position: absolute; bottom: 74px; left: 50%; transform: translateX(-50%);
  font-size: 12px; color: rgba(255,255,255,0.75); text-shadow: 0 0 3px #000; }
`;

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

  setPlayers(me: string, others: { name: string; action?: string }[]): void {
    if (!this.playersEl) return;
    const rows = [
      `<b>${escapeHtml(me)} (you)</b>`,
      ...others.map((p) => {
        const doing =
          p.action && p.action !== "idle"
            ? ` <span style="color:#9fb0c3;font-size:11px">· ${escapeHtml(p.action)}</span>`
            : "";
        return `${escapeHtml(p.name)}${doing}`;
      }),
    ];
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

}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
