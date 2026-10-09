/**
 * Keyboard and on-screen pad, folded into one `Input` per frame.
 *
 * Two layouts at once so nobody has to read a manual: WASD + J/K/L/I, or the
 * arrows + Z/X/C/V.
 */
import type { Input } from "./sim";

export type Button = "left" | "right" | "up" | "down" | "punch" | "kick" | "block" | "special";

const KEYS: Record<string, Button> = {
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyJ: "punch",
  KeyZ: "punch",
  KeyK: "kick",
  KeyX: "kick",
  KeyL: "block",
  KeyC: "block",
  ShiftLeft: "block",
  KeyI: "special",
  KeyV: "special",
};

/** Human-readable key names, for the legend under the arena. */
export const LEGEND: { button: Button; label: string; keys: string[] }[] = [
  { button: "left", label: "Move", keys: ["A", "D"] },
  { button: "up", label: "Jump", keys: ["W"] },
  { button: "down", label: "Crouch", keys: ["S"] },
  { button: "punch", label: "Punch", keys: ["J"] },
  { button: "kick", label: "Kick", keys: ["K"] },
  { button: "block", label: "Block", keys: ["L"] },
  { button: "special", label: "Special", keys: ["I"] },
];

function typing(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

export class Controls {
  private held = new Set<Button>();
  private edges = new Set<Button>();
  private virtual = new Set<Button>();

  private onDown = (e: KeyboardEvent) => {
    if (typing() || e.metaKey || e.ctrlKey || e.altKey) return;
    const b = KEYS[e.code];
    if (!b) return;
    e.preventDefault();
    if (!this.held.has(b)) this.edges.add(b);
    this.held.add(b);
  };

  private onUp = (e: KeyboardEvent) => {
    const b = KEYS[e.code];
    if (b) this.held.delete(b);
  };

  private onBlur = () => {
    this.held.clear();
    this.virtual.clear();
  };

  attach(): () => void {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
    window.addEventListener("blur", this.onBlur);
    return () => {
      window.removeEventListener("keydown", this.onDown);
      window.removeEventListener("keyup", this.onUp);
      window.removeEventListener("blur", this.onBlur);
    };
  }

  /** The on-screen pad. */
  press(b: Button, down: boolean) {
    if (down) {
      if (!this.virtual.has(b)) this.edges.add(b);
      this.virtual.add(b);
    } else {
      this.virtual.delete(b);
    }
  }

  /** This frame's input; consumes the edges. */
  read(): Input {
    const on = (b: Button) => this.held.has(b) || this.virtual.has(b);
    const input: Input = {
      left: on("left"),
      right: on("right"),
      up: on("up"),
      down: on("down"),
      block: on("block"),
      punch: this.edges.has("punch"),
      kick: this.edges.has("kick"),
      special: this.edges.has("special"),
    };
    // A jump is an edge too: holding up should not bunny-hop.
    input.up = this.edges.has("up");
    this.edges.clear();
    return input;
  }

  clear() {
    this.held.clear();
    this.edges.clear();
    this.virtual.clear();
  }
}
