/**
 * One fighter's body: physics, the move list, hitboxes and hit reactions.
 *
 * Fixed 60 Hz step, arena pixels. A `Fighter` is either SIMULATED (driven by an
 * `Input` — the local player, or the CPU) or a PUPPET (its fields are written
 * from the opponent's presence slices and it only animates). Both draw the
 * same way.
 *
 * Damage is NOT decided here. The numbers below mirror `damage_of` in the
 * contract so the health bars can move the instant a blow lands, but the
 * contract's figure is the one the bars settle on.
 */
import type { FighterDef } from "./fighters";

export const W = 480;
export const H = 270;
/** Screen y of the arena floor. */
export const FLOOR = 238;
export const MIN_X = 24;
export const MAX_X = W - 24;
/** Closest two fighters' centres can stand. */
export const PUSH = 30;

export type StateName =
  | "idle"
  | "walk"
  | "crouch"
  | "jump"
  | "punch"
  | "kick"
  | "uppercut"
  | "sweep"
  | "air_kick"
  | "special"
  | "block"
  | "blockstun"
  | "hit"
  | "launched"
  | "knockdown"
  | "ko"
  | "victory";

export type MoveKind = "punch" | "kick" | "uppercut" | "sweep" | "air_kick" | "special" | "jump" | "block";

/** Mirrors `damage_of` in logic/src/lib.rs. */
export const DAMAGE: Record<MoveKind, number> = {
  punch: 5,
  kick: 7,
  uppercut: 13,
  sweep: 9,
  air_kick: 8,
  special: 11,
  jump: 0,
  block: 0,
};
export const CHIP = 1;

export const MOVE_KINDS: MoveKind[] = ["punch", "kick", "uppercut", "sweep", "air_kick", "special", "jump", "block"];

interface MoveSpec {
  frames: number;
  /** First and last frame the hitbox is out. */
  active: [number, number];
  /** How far in front of the fighter's centre the hitbox reaches. */
  reach: number;
  /** Hitbox height band, above the fighter's feet. */
  y0: number;
  y1: number;
  /** Forward drift while the move plays, px/frame. */
  lunge: number;
}

export const MOVES: Record<"punch" | "kick" | "uppercut" | "sweep" | "air_kick" | "special", MoveSpec> = {
  punch: { frames: 18, active: [4, 8], reach: 40, y0: 60, y1: 82, lunge: 0.6 },
  kick: { frames: 26, active: [8, 13], reach: 50, y0: 42, y1: 72, lunge: 0.3 },
  uppercut: { frames: 32, active: [7, 13], reach: 34, y0: 40, y1: 118, lunge: 0.5 },
  sweep: { frames: 30, active: [9, 15], reach: 54, y0: 0, y1: 20, lunge: 0.2 },
  air_kick: { frames: 999, active: [3, 999], reach: 42, y0: 6, y1: 46, lunge: 0 },
  special: { frames: 36, active: [14, 14], reach: 0, y0: 0, y1: 0, lunge: 0 },
};

const GRAVITY = 0.36;
const JUMP_VY = 7.4;
const JUMP_VX = 2.4;
const WALK_FWD = 2.1;
const WALK_BACK = 1.7;
const SPECIAL_COOLDOWN = 80;
const PROJECTILE_SPEED = 4.6;

export interface Input {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  block: boolean;
  /** Edges: true on the frame the button went down. */
  punch: boolean;
  kick: boolean;
  special: boolean;
}

export const NO_INPUT: Input = {
  left: false,
  right: false,
  up: false,
  down: false,
  block: false,
  punch: false,
  kick: false,
  special: false,
};

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Projectile {
  x: number;
  /** Height above the floor. */
  y: number;
  vx: number;
  age: number;
}

/** What a step produced, for the controller to act on. */
export type SimEvent =
  /** One finished action — becomes one transaction. */
  | { t: "action"; kind: MoveKind; hit: boolean; blocked: boolean }
  /** A blow connected. `x`/`y` are where, for sparks. */
  | { t: "hit"; kind: MoveKind; blocked: boolean; x: number; y: number }
  | { t: "swing"; kind: MoveKind }
  | { t: "jump" }
  | { t: "land" }
  | { t: "throw" };

/** What a step needs to know about the other fighter. */
export interface Target {
  x: number;
  hurtbox(): Box | null;
  /** Guarding, and facing the attacker at `fromX`. */
  guarding(fromX: number): boolean;
}

const CONTROLLABLE: ReadonlySet<StateName> = new Set(["idle", "walk", "crouch", "block"]);
const ATTACKS: ReadonlySet<StateName> = new Set(["punch", "kick", "uppercut", "sweep", "air_kick", "special"]);

export class Fighter {
  x: number;
  /** Height above the floor. */
  y = 0;
  vx = 0;
  vy = 0;
  facing: 1 | -1;
  state: StateName = "idle";
  /** Frames spent in `state`. */
  frame = 0;
  /** Walk cycle phase, radians. */
  walk = 0;
  /** The current attack has already connected. */
  connected = false;
  usedAirKick = false;
  specialCd = 0;
  /** Frames of white flash left after being hit. */
  flash = 0;
  projectile: Projectile | null = null;

  constructor(
    public def: FighterDef,
    x: number,
    facing: 1 | -1,
  ) {
    this.x = x;
    this.facing = facing;
  }

  reset(x: number, facing: 1 | -1) {
    this.x = x;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.state = "idle";
    this.frame = 0;
    this.connected = false;
    this.usedAirKick = false;
    this.specialCd = 0;
    this.flash = 0;
    this.projectile = null;
  }

  get airborne(): boolean {
    return this.y > 0.01 || this.vy !== 0;
  }

  get down(): boolean {
    return this.state === "ko" || this.state === "knockdown";
  }

  private enter(state: StateName) {
    this.state = state;
    this.frame = 0;
    this.connected = false;
  }

  hurtbox(): Box | null {
    switch (this.state) {
      case "ko":
      case "knockdown":
      case "victory":
        return null;
      case "crouch":
      case "sweep":
        return { x0: this.x - 15, x1: this.x + 15, y0: this.y, y1: this.y + 62 };
      case "jump":
      case "air_kick":
      case "launched":
        return { x0: this.x - 14, x1: this.x + 14, y0: this.y + 8, y1: this.y + 82 };
      default:
        return { x0: this.x - 15, x1: this.x + 15, y0: this.y, y1: this.y + 96 };
    }
  }

  guarding(fromX: number): boolean {
    if (this.state !== "block" && this.state !== "blockstun") return false;
    const toward = Math.sign(fromX - this.x) || this.facing;
    return toward === this.facing;
  }

  /** The active hitbox of the current attack, if it is out this frame. */
  hitbox(): Box | null {
    if (!ATTACKS.has(this.state) || this.state === "special" || this.connected) return null;
    const spec = MOVES[this.state as keyof typeof MOVES];
    if (this.frame < spec.active[0] || this.frame > spec.active[1]) return null;
    const near = this.x + this.facing * 6;
    const far = this.x + this.facing * spec.reach;
    return {
      x0: Math.min(near, far),
      x1: Math.max(near, far),
      y0: this.y + spec.y0,
      y1: this.y + spec.y1,
    };
  }

  /**
   * One frame of a SIMULATED fighter.
   *
   * `opp` is whoever is across the arena, read for facing, hits and guard.
   */
  step(input: Input, opp: Target, out: SimEvent[]) {
    this.frame += 1;
    if (this.specialCd > 0) this.specialCd -= 1;
    if (this.flash > 0) this.flash -= 1;

    const back = this.facing === 1 ? input.left : input.right;
    const fwd = this.facing === 1 ? input.right : input.left;

    // ── decide ──────────────────────────────────────────────────────────
    if (CONTROLLABLE.has(this.state) && !this.airborne) {
      this.faceToward(opp.x);
      if (input.special && this.specialCd === 0 && !this.projectile) {
        this.enter("special");
        this.vx = 0;
      } else if (input.punch) {
        this.enter(input.down ? "uppercut" : "punch");
        this.vx = 0;
        out.push({ t: "swing", kind: this.state as MoveKind });
      } else if (input.kick) {
        this.enter(input.down ? "sweep" : "kick");
        this.vx = 0;
        out.push({ t: "swing", kind: this.state as MoveKind });
      } else if (input.block) {
        if (this.state !== "block") {
          this.enter("block");
          out.push({ t: "action", kind: "block", hit: false, blocked: false });
        }
        this.vx = 0;
      } else if (input.up) {
        this.enter("jump");
        this.vy = JUMP_VY;
        this.y = 0.02;
        this.vx = (fwd ? 1 : back ? -1 : 0) * this.facing * JUMP_VX;
        this.usedAirKick = false;
        out.push({ t: "jump" }, { t: "action", kind: "jump", hit: false, blocked: false });
      } else if (input.down) {
        if (this.state !== "crouch") this.enter("crouch");
        this.vx = 0;
      } else if (fwd || back) {
        if (this.state !== "walk") this.enter("walk");
        this.vx = (fwd ? WALK_FWD : -WALK_BACK) * this.facing;
        this.walk += (fwd ? 0.22 : -0.2);
      } else {
        if (this.state !== "idle") this.enter("idle");
        this.vx = 0;
      }
    } else if ((this.state === "jump") && input.kick && !this.usedAirKick) {
      this.usedAirKick = true;
      this.enter("air_kick");
      out.push({ t: "swing", kind: "air_kick" });
    }

    // ── move ────────────────────────────────────────────────────────────
    this.integrate();

    // Attacks play out, lunge a little, and resolve.
    if (ATTACKS.has(this.state)) {
      const kind = this.state as keyof typeof MOVES;
      const spec = MOVES[kind];
      if (!this.airborne) this.x += this.facing * (this.frame < spec.active[1] ? spec.lunge : 0);

      if (kind === "special" && this.frame === spec.active[0]) {
        this.projectile = {
          x: this.x + this.facing * 26,
          y: this.y + 64,
          vx: this.facing * PROJECTILE_SPEED,
          age: 0,
        };
        this.specialCd = SPECIAL_COOLDOWN;
        out.push({ t: "throw" });
      }

      const box = this.hitbox();
      const hurt = box ? opp.hurtbox() : null;
      if (box && hurt && overlaps(box, hurt)) {
        this.connected = true;
        const blocked = opp.guarding(this.x);
        out.push(
          { t: "action", kind, hit: true, blocked },
          {
            t: "hit",
            kind,
            blocked,
            x: this.x + this.facing * Math.min(spec.reach - 6, Math.abs(opp.x - this.x)),
            y: (Math.max(box.y0, hurt.y0) + Math.min(box.y1, hurt.y1)) / 2,
          },
        );
      }

      const over = kind === "air_kick" ? !this.airborne : this.frame >= spec.frames;
      if (over) {
        if (!this.connected && kind !== "special") {
          out.push({ t: "action", kind, hit: false, blocked: false });
        }
        if (kind === "air_kick") out.push({ t: "land" });
        this.enter("idle");
      }
    }

    // A jump lands.
    if (this.state === "jump" && !this.airborne) {
      this.enter("idle");
      out.push({ t: "land" });
    }

    this.tickRecovery(out);
    this.stepProjectile(opp, out);
  }

  /** Physics and recovery only — for a puppet's own projectile-free body. */
  private integrate() {
    if (this.airborne) {
      this.vy -= GRAVITY;
      this.y += this.vy;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
      }
    }
    this.x += this.vx;
    if (!this.airborne && !CONTROLLABLE.has(this.state) && !ATTACKS.has(this.state)) {
      this.vx *= 0.86;
    }
    this.x = Math.max(MIN_X, Math.min(MAX_X, this.x));
  }

  private tickRecovery(out: SimEvent[]) {
    switch (this.state) {
      case "hit":
        if (this.frame >= 16) this.enter("idle");
        break;
      case "blockstun":
        if (this.frame >= 12) this.enter("block");
        break;
      case "launched":
        if (!this.airborne && this.frame > 2) {
          this.enter("knockdown");
          out.push({ t: "land" });
        }
        break;
      case "knockdown":
        if (this.frame >= 62) this.enter("idle");
        break;
      default:
        break;
    }
  }

  private stepProjectile(opp: Target, out: SimEvent[]) {
    const p = this.projectile;
    if (!p) return;
    p.x += p.vx;
    p.age += 1;
    const hurt = opp.hurtbox();
    const box = { x0: p.x - 8, x1: p.x + 8, y0: p.y - 8, y1: p.y + 8 };
    if (hurt && overlaps(box, hurt)) {
      const blocked = opp.guarding(p.x - p.vx * 4);
      out.push(
        { t: "action", kind: "special", hit: true, blocked },
        { t: "hit", kind: "special", blocked, x: p.x, y: p.y },
      );
      this.projectile = null;
    } else if (p.x < -30 || p.x > W + 30) {
      out.push({ t: "action", kind: "special", hit: false, blocked: false });
      this.projectile = null;
    }
  }

  faceToward(x: number) {
    const dir = Math.sign(x - this.x);
    if (dir !== 0) this.facing = dir as 1 | -1;
  }

  /**
   * Take a blow thrown from `fromX`. Called for the LOCAL fighter when the
   * opponent's slice says a blow landed, and for both in practice mode.
   */
  takeHit(kind: MoveKind, blocked: boolean, fromX: number) {
    if (this.state === "ko" || this.state === "knockdown") return;
    const away = (Math.sign(this.x - fromX) || -this.facing) as 1 | -1;
    if (blocked) {
      this.enter("blockstun");
      this.vx = away * 2.2;
      return;
    }
    this.flash = 6;
    if (kind === "uppercut" || this.airborne) {
      this.enter("launched");
      this.vy = kind === "uppercut" ? 6.6 : 3.4;
      this.y = Math.max(this.y, 0.5);
      this.vx = away * 2.4;
    } else if (kind === "sweep") {
      this.enter("knockdown");
      this.vx = away * 1.4;
    } else {
      this.enter("hit");
      this.vx = away * (kind === "special" ? 3.2 : 2.6);
    }
  }

  /** Lose the round: fall, and stay down. */
  knockOut(fromX: number) {
    const away = (Math.sign(this.x - fromX) || -this.facing) as 1 | -1;
    this.enter("ko");
    this.flash = 8;
    this.vy = 4.2;
    this.y = Math.max(this.y, 0.5);
    this.vx = away * 2.6;
    this.projectile = null;
  }

  win() {
    if (this.state !== "victory") {
      this.enter("victory");
      this.vx = 0;
    }
  }

  /** Physics for states with no input: KO falls, victory stands. */
  idleStep() {
    this.frame += 1;
    if (this.flash > 0) this.flash -= 1;
    this.integrate();
    if (this.state === "launched" && !this.airborne && this.frame > 2) this.enter("knockdown");
    if (this.projectile) {
      this.projectile.x += this.projectile.vx;
      this.projectile.age += 1;
      if (this.projectile.x < -30 || this.projectile.x > W + 30) this.projectile = null;
    }
  }
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/** Keep two grounded-ish bodies from walking through each other. */
export function separate(a: Fighter, b: Fighter, moveA: boolean, moveB: boolean) {
  if (a.down || b.down) return;
  const overlapY = Math.abs(a.y - b.y) < 60;
  const dx = b.x - a.x;
  if (!overlapY || Math.abs(dx) >= PUSH) return;
  const push = PUSH - Math.abs(dx);
  const dir = Math.sign(dx) || (a.x < 240 ? 1 : -1);
  if (moveA && moveB) {
    a.x -= (dir * push) / 2;
    b.x += (dir * push) / 2;
  } else if (moveA) {
    a.x -= dir * push;
  } else if (moveB) {
    b.x += dir * push;
  }
  a.x = Math.max(MIN_X, Math.min(MAX_X, a.x));
  b.x = Math.max(MIN_X, Math.min(MAX_X, b.x));
}
