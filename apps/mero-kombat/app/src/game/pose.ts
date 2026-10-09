/**
 * Poses: what a body looks like in each state, as joint angles.
 *
 * Angles are radians measured from straight DOWN, positive rotating toward the
 * way the fighter faces. A limb is `[root, bend]`:
 *
 *  * arm  — upper arm at `root`, forearm at `root + bend` (elbows bend up/forward)
 *  * leg  — thigh at `root`, shin at `root - bend` (knees bend backward)
 *
 * `lean` tilts the torso forward from vertical, `rot` spins the whole body
 * about the hips (falling, tumbling). Keyframes are blended with an ease, so a
 * punch snaps out and drifts back the way a sprite animation would.
 */
import type { StateName } from "./sim";

export interface Pose {
  lean: number;
  head: number;
  rot: number;
  /** Hips pushed forward of the feet, px. */
  hipDX: number;
  aB: [number, number];
  aF: [number, number];
  lB: [number, number];
  lF: [number, number];
}

const P = (
  lean: number,
  head: number,
  aB: [number, number],
  aF: [number, number],
  lB: [number, number],
  lF: [number, number],
  rot = 0,
  hipDX = 0,
): Pose => ({ lean, head, aB, aF, lB, lF, rot, hipDX });

// ── the library ─────────────────────────────────────────────────────────────

const STANCE = P(0.14, -0.05, [0.25, 2.4], [0.55, 2.15], [-0.38, 0.38], [0.36, 0.5]);
const CROUCH = P(0.38, -0.15, [0.6, 2.2], [0.85, 2.0], [0.15, 2.5], [1.15, 2.25]);
const BLOCK = P(-0.08, 0.05, [1.05, 2.6], [1.3, 2.45], [-0.4, 0.35], [0.32, 0.45]);
const HURT = P(-0.5, -0.55, [-0.6, 0.6], [0.15, 0.5], [-0.3, 0.6], [0.35, 0.35]);
const LYING = P(0, -0.1, [2.5, 0.3], [0.9, 0.5], [0.05, 0.35], [0.25, 0.7], -1.52);
const VICTORY = P(-0.06, -0.18, [0.35, 2.0], [3.0, 0.1], [-0.28, 0.12], [0.28, 0.12]);

type Key = [frame: number, pose: Pose];

const ANIMS: Partial<Record<StateName, Key[]>> = {
  punch: [
    [0, STANCE],
    [3, P(0.1, -0.05, [0.2, 2.5], [0.75, 2.4], [-0.38, 0.38], [0.36, 0.5], 0, -1)],
    [5, P(0.24, -0.08, [0.1, 2.6], [1.52, 0.04], [-0.42, 0.3], [0.42, 0.42], 0, 4)],
    [10, P(0.24, -0.08, [0.1, 2.6], [1.5, 0.08], [-0.42, 0.3], [0.42, 0.42], 0, 4)],
    [18, STANCE],
  ],
  kick: [
    [0, STANCE],
    [6, P(-0.15, 0, [0.0, 1.6], [0.9, 1.9], [-0.12, 0.2], [1.35, 2.2])],
    [9, P(-0.42, 0.05, [-0.4, 1.2], [0.9, 1.7], [-0.16, 0.12], [1.78, 0.05])],
    [15, P(-0.42, 0.05, [-0.4, 1.2], [0.9, 1.7], [-0.16, 0.12], [1.75, 0.08])],
    [20, P(-0.15, 0, [0.0, 1.6], [0.9, 1.9], [-0.12, 0.2], [1.3, 2.1])],
    [26, STANCE],
  ],
  uppercut: [
    [0, STANCE],
    [6, P(0.42, -0.1, [0.4, 1.8], [0.2, 0.9], [0.1, 2.4], [1.05, 2.15])],
    [9, P(-0.05, -0.2, [0.3, 1.5], [2.95, 0.05], [-0.25, 0.3], [0.2, 0.35], 0, 2)],
    [16, P(-0.05, -0.2, [0.3, 1.5], [2.95, 0.05], [-0.25, 0.3], [0.2, 0.35], 0, 2)],
    [32, STANCE],
  ],
  sweep: [
    [0, CROUCH],
    [8, P(0.75, -0.25, [-0.15, 0.3], [0.55, 0.2], [0.95, 2.65], [1.45, 0.6])],
    [11, P(0.8, -0.25, [-0.2, 0.3], [0.55, 0.15], [0.95, 2.7], [1.5, 0.02])],
    [18, P(0.8, -0.25, [-0.2, 0.3], [0.55, 0.15], [0.95, 2.7], [1.5, 0.02])],
    [30, CROUCH],
  ],
  special: [
    [0, STANCE],
    [10, P(-0.18, 0, [-0.75, 0.5], [-0.6, 0.7], [-0.45, 0.25], [0.45, 0.45], 0, -2)],
    [14, P(0.28, -0.05, [1.38, 0.08], [1.52, 0.02], [-0.45, 0.25], [0.5, 0.35], 0, 4)],
    [26, P(0.28, -0.05, [1.38, 0.08], [1.52, 0.02], [-0.45, 0.25], [0.5, 0.35], 0, 4)],
    [36, STANCE],
  ],
  blockstun: [
    [0, P(-0.25, 0.1, [1.05, 2.6], [1.3, 2.45], [-0.45, 0.4], [0.3, 0.5])],
    [12, BLOCK],
  ],
  hit: [
    [0, HURT],
    [10, HURT],
    [16, STANCE],
  ],
  knockdown: [
    [0, P(-0.6, -0.4, [-0.6, 0.6], [0.3, 0.5], [0.2, 0.3], [0.6, 0.4], -0.8)],
    [10, LYING],
    [44, LYING],
    [54, CROUCH],
    [62, STANCE],
  ],
  ko: [
    [0, P(-0.6, -0.5, [-0.8, 0.6], [0.3, 0.5], [0.2, 0.3], [0.6, 0.4], -0.6)],
    [16, LYING],
  ],
  launched: [
    [0, P(-0.5, -0.5, [-1.0, 0.4], [0.2, 0.3], [0.4, 0.5], [0.8, 0.6], -0.5)],
    [24, P(-0.4, -0.4, [-1.3, 0.3], [-0.2, 0.3], [0.5, 0.8], [0.9, 1.0], -1.3)],
  ],
};

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function mixPair(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function mix(a: Pose, b: Pose, t: number): Pose {
  const m = (x: number, y: number) => x + (y - x) * t;
  return {
    lean: m(a.lean, b.lean),
    head: m(a.head, b.head),
    rot: m(a.rot, b.rot),
    hipDX: m(a.hipDX, b.hipDX),
    aB: mixPair(a.aB, b.aB, t),
    aF: mixPair(a.aF, b.aF, t),
    lB: mixPair(a.lB, b.lB, t),
    lF: mixPair(a.lF, b.lF, t),
  };
}

function sample(keys: Key[], frame: number): Pose {
  if (frame <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    const [f1, p1] = keys[i];
    const [f0, p0] = keys[i - 1];
    if (frame <= f1) return mix(p0, p1, ease((frame - f0) / Math.max(1, f1 - f0)));
  }
  return keys[keys.length - 1][1];
}

export interface PoseInput {
  state: StateName;
  frame: number;
  walk: number;
  vy: number;
  airborne: boolean;
  /** A global clock, for breathing. */
  time: number;
}

/** The pose for a fighter this frame. */
export function poseFor(f: PoseInput): Pose {
  const breathe = Math.sin(f.time * 0.08) * 0.04;
  switch (f.state) {
    case "idle": {
      const p = { ...STANCE, aF: [STANCE.aF[0] + breathe, STANCE.aF[1]] as [number, number] };
      p.lean += breathe * 0.6;
      return p;
    }
    case "walk": {
      const s = Math.sin(f.walk);
      const c = Math.cos(f.walk);
      return P(
        0.16,
        -0.05,
        [0.25 - s * 0.15, 2.3],
        [0.55 + s * 0.15, 2.1],
        [s * 0.45, 0.25 + Math.max(0, c) * 0.7],
        [-s * 0.45, 0.25 + Math.max(0, -c) * 0.7],
      );
    }
    case "crouch":
      return CROUCH;
    case "block":
      return BLOCK;
    case "victory": {
      const pump = Math.max(0, Math.sin(f.time * 0.12)) * 0.15;
      return { ...VICTORY, aF: [VICTORY.aF[0] - pump, VICTORY.aF[1] + pump] };
    }
    case "jump":
    case "air_kick": {
      const rising = f.vy > 1.5;
      const tuck = rising
        ? P(0.05, -0.1, [0.8, 1.2], [1.3, 1.3], [-0.2, 0.6], [0.5, 0.9])
        : P(0.2, -0.05, [0.5, 1.8], [1.1, 1.5], [0.5, 2.3], [1.05, 2.3]);
      if (f.state === "jump") return tuck;
      const kick = P(-0.3, 0, [-0.6, 0.9], [2.2, 0.6], [0.35, 2.3], [1.05, 0.02]);
      return mix(tuck, kick, Math.min(1, f.frame / 4));
    }
    default: {
      const keys = ANIMS[f.state];
      return keys ? sample(keys, f.frame) : STANCE;
    }
  }
}
