// Touch controls, drawn as an HTML layer over the canvas so iOS and Android show exactly the same
// thing: a floating joystick under the left thumb, drag anywhere else to look, jump / break / place
// buttons under the right thumb, the hotbar along the bottom, and the menu button top left.
// Replaces the web build's pointer lock, keyboard and mouse.

import { blockDef, HOTBAR } from "../../../app/src/engine/blocks";

/** Material Symbols paths (24 × 24), so the overlay matches the apps' icon set. */
const ICONS = {
  pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  jump: "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z",
  place:
    "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z",
  breakBlock: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z",
  players:
    "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
};

const svg = (path: string, size = 26): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;

/** Radians the camera turns per CSS pixel of drag, before the player's sensitivity. */
export const LOOK_PER_PX = 0.0045;
/** The joystick's travel, in CSS pixels. */
export const STICK_RADIUS = 52;
/** Stick deflection below this reads as centred. */
export const STICK_DEADZONE = 0.18;
/** The left share of the screen where a touch grabs the joystick. */
export const STICK_ZONE = 0.42;

/**
 * Joystick deflection → movement: x to the right, y forward, each in -1..1, zero inside the
 * dead zone. `dx`/`dy` are the thumb's travel from where it landed, in screen pixels (y down).
 */
export function stickVector(dx: number, dy: number, radius = STICK_RADIUS): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 0 };
  const clamped = Math.min(len, radius);
  const mag = clamped / radius;
  if (mag < STICK_DEADZONE) return { x: 0, y: 0 };
  return { x: (dx / len) * mag, y: (-dy / len) * mag };
}

export interface ControlCallbacks {
  onSelect(slot: number): void;
  onMenu(): void;
}

export class TouchControls {
  /** -1..1 each: x strafes right, y walks forward. */
  move = { x: 0, y: 0 };
  jump = false;
  breakHeld = false;
  placeHeld = false;
  /** Set on a fresh press of break/place so the first edit happens at once; the game clears it. */
  freshPress = false;

  private lookDx = 0;
  private lookDy = 0;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookAt = { x: 0, y: 0 };

  readonly root: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private slots: HTMLElement[] = [];
  private playersEl: HTMLElement;
  private toastsEl: HTMLElement;

  constructor(
    parent: HTMLElement,
    private cb: ControlCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.id = "controls";
    this.root.innerHTML = `
      <div id="crosshair"></div>
      <button class="round small" id="menu-btn" aria-label="Menu">${svg(ICONS.pause, 22)}</button>
      <div id="players-chip">${svg(ICONS.players, 16)}<span>1</span></div>
      <div id="toasts"></div>
      <div id="stick-base"><div id="stick-knob"></div></div>
      <div id="hotbar"></div>
      <button class="round" id="place-btn" aria-label="Place block">${svg(ICONS.place)}</button>
      <button class="round" id="break-btn" aria-label="Break block">${svg(ICONS.breakBlock)}</button>
      <button class="round big" id="jump-btn" aria-label="Jump">${svg(ICONS.jump, 30)}</button>
    `;
    parent.appendChild(this.root);
    this.base = this.root.querySelector("#stick-base")!;
    this.knob = this.root.querySelector("#stick-knob")!;
    this.playersEl = this.root.querySelector("#players-chip span")!;
    this.toastsEl = this.root.querySelector("#toasts")!;

    const hotbar = this.root.querySelector("#hotbar")!;
    this.slots = HOTBAR.map((id, i) => {
      const def = blockDef(id);
      const [r, g, b] = def.colors[0];
      const slot = document.createElement("button");
      slot.className = "slot";
      slot.setAttribute("aria-label", def.name);
      slot.innerHTML = `<span class="swatch" style="background: rgb(${Math.round(r * 255)},${Math.round(
        g * 255,
      )},${Math.round(b * 255)})"></span>`;
      slot.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.cb.onSelect(i);
      });
      hotbar.appendChild(slot);
      return slot;
    });

    this.hold("#jump-btn", (down) => (this.jump = down));
    this.hold("#break-btn", (down) => {
      this.breakHeld = down;
      if (down) this.freshPress = true;
    });
    this.hold("#place-btn", (down) => {
      this.placeHeld = down;
      if (down) this.freshPress = true;
    });
    this.root.querySelector("#menu-btn")!.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.cb.onMenu();
    });

    this.root.addEventListener("pointerdown", (e) => this.down(e));
    this.root.addEventListener("pointermove", (e) => this.moveTo(e));
    this.root.addEventListener("pointerup", (e) => this.up(e));
    this.root.addEventListener("pointercancel", (e) => this.up(e));
    // No long-press callout, selection or double-tap zoom anywhere in the game.
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  setSelected(index: number): void {
    this.slots.forEach((s, i) => s.classList.toggle("sel", i === index));
  }

  setPlayers(count: number): void {
    this.playersEl.textContent = String(count);
  }

  toast(text: string): void {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    this.toastsEl.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  /** The look drag since the last call, in pixels. */
  takeLook(): { dx: number; dy: number } {
    const out = { dx: this.lookDx, dy: this.lookDy };
    this.lookDx = 0;
    this.lookDy = 0;
    return out;
  }

  /** Let go of everything: the app went to the background or a menu opened. */
  release(): void {
    this.move = { x: 0, y: 0 };
    this.jump = this.breakHeld = this.placeHeld = this.freshPress = false;
    this.lookDx = this.lookDy = 0;
    this.stickId = this.lookId = null;
    this.base.classList.remove("on");
    this.root.querySelectorAll(".round.down").forEach((b) => b.classList.remove("down"));
  }

  private hold(selector: string, set: (down: boolean) => void): void {
    const btn = this.root.querySelector<HTMLElement>(selector)!;
    let id: number | null = null;
    btn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      id = e.pointerId;
      btn.setPointerCapture(e.pointerId);
      btn.classList.add("down");
      set(true);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      e.stopPropagation();
      id = null;
      btn.classList.remove("down");
      set(false);
    };
    btn.addEventListener("pointerup", end);
    btn.addEventListener("pointercancel", end);
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    if (e.clientX < window.innerWidth * STICK_ZONE && this.stickId === null) {
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.knob.style.transform = "translate(-50%, -50%)";
      this.base.classList.add("on");
      this.root.setPointerCapture(e.pointerId);
      return;
    }
    if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookAt = { x: e.clientX, y: e.clientY };
      this.root.setPointerCapture(e.pointerId);
    }
  }

  private moveTo(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      const dx = e.clientX - this.stickOrigin.x;
      const dy = e.clientY - this.stickOrigin.y;
      this.move = stickVector(dx, dy);
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.min(len, STICK_RADIUS) / len;
      this.knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
    } else if (e.pointerId === this.lookId) {
      this.lookDx += e.clientX - this.lookAt.x;
      this.lookDy += e.clientY - this.lookAt.y;
      this.lookAt = { x: e.clientX, y: e.clientY };
    }
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.move = { x: 0, y: 0 };
      this.base.classList.remove("on");
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
    }
  }
}
