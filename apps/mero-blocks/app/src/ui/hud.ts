// DOM HUD: crosshair, hotbar, debug overlay, player list, toasts, connect screen.

import { blockDef, HOTBAR } from "../engine/blocks";

const css = `
#mb-hud { position: fixed; inset: 0; pointer-events: none; color: #fff; z-index: 10; }
#mb-crosshair { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  font-size: 20px; opacity: 0.85; text-shadow: 0 0 3px #000; }
#mb-hotbar { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 5px; }
.mb-slot { width: 44px; height: 44px; border: 2px solid rgba(255,255,255,0.35);
  border-radius: 6px; background: rgba(0,0,0,0.35); display: flex; align-items: center;
  justify-content: center; flex-direction: column; font-size: 9px; }
.mb-slot.sel { border-color: #fff; background: rgba(255,255,255,0.18); }
.mb-swatch { width: 22px; height: 22px; border-radius: 3px; margin-bottom: 2px; }
#mb-debug { position: absolute; top: 10px; left: 10px; font: 11px/1.5 monospace;
  background: rgba(0,0,0,0.45); padding: 6px 10px; border-radius: 6px; white-space: pre; }
#mb-players { position: absolute; top: 10px; right: 10px; font: 12px/1.6 system-ui;
  background: rgba(0,0,0,0.45); padding: 6px 12px; border-radius: 6px; min-width: 120px; }
#mb-toasts { position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 4px; align-items: center; }
.mb-toast { background: rgba(0,0,0,0.65); padding: 5px 14px; border-radius: 14px;
  font-size: 13px; animation: mbfade 4s forwards; }
@keyframes mbfade { 0%,80% { opacity: 1; } 100% { opacity: 0; } }
#mb-hint { position: absolute; bottom: 70px; left: 50%; transform: translateX(-50%);
  font-size: 12px; color: rgba(255,255,255,0.75); text-shadow: 0 0 3px #000; }
`;

export class Hud {
  root: HTMLElement;
  private debugEl!: HTMLElement;
  private playersEl!: HTMLElement;
  private toastsEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private slots: HTMLElement[] = [];

  constructor(parent: HTMLElement) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    this.root = document.createElement("div");
    this.root.id = "mb-hud";
    parent.appendChild(this.root);
  }

  showGameHud(): void {
    this.root.innerHTML = `
      <div id="mb-crosshair">+</div>
      <div id="mb-hotbar" data-testid="hotbar"></div>
      <div id="mb-debug" data-testid="debug"></div>
      <div id="mb-players" data-testid="players"></div>
      <div id="mb-toasts"></div>
      <div id="mb-hint">click to play — WASD move, LMB break, RMB place, 1-9 blocks</div>
    `;
    this.debugEl = this.root.querySelector("#mb-debug")!;
    this.playersEl = this.root.querySelector("#mb-players")!;
    this.toastsEl = this.root.querySelector("#mb-toasts")!;
    this.hintEl = this.root.querySelector("#mb-hint")!;
    const hotbar = this.root.querySelector("#mb-hotbar")!;
    this.slots = HOTBAR.map((id, i) => {
      const def = blockDef(id);
      const slot = document.createElement("div");
      slot.className = "mb-slot";
      slot.dataset.testid = `slot-${i}`;
      const [r, g, b] = def.colors[0];
      slot.innerHTML = `<div class="mb-swatch" style="background: rgb(${r * 255},${g * 255},${b * 255})"></div>${def.name}`;
      hotbar.appendChild(slot);
      return slot;
    });
    this.setHotbarSel(0);
  }

  setHotbarSel(index: number): void {
    this.slots.forEach((s, i) => s.classList.toggle("sel", i === index));
  }

  setDebug(text: string): void {
    if (this.debugEl) this.debugEl.textContent = text;
  }

  setHint(visible: boolean): void {
    if (this.hintEl) this.hintEl.style.display = visible ? "" : "none";
  }

  setPlayers(me: string, others: { name: string }[]): void {
    if (!this.playersEl) return;
    const rows = [`<b>${escapeHtml(me)} (you)</b>`, ...others.map((p) => escapeHtml(p.name))];
    this.playersEl.innerHTML = rows.join("<br>");
  }

  toast(msg: string): void {
    if (!this.toastsEl) return;
    const el = document.createElement("div");
    el.className = "mb-toast";
    el.textContent = msg;
    this.toastsEl.appendChild(el);
    setTimeout(() => el.remove(), 4100);
  }

}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
