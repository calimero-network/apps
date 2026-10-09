/**
 * Drawing a fighter: forward kinematics from a `Pose`, then shaded, outlined
 * body parts in the old arcade order — far arm, far leg, torso, near leg, head,
 * near arm.
 *
 * Everything is drawn into a 480×270 canvas that CSS scales up with
 * `image-rendering: pixelated`, so smooth vector shapes come out as chunky
 * arcade pixels without a single sprite sheet.
 */
import type { FighterDef } from "./fighters";
import type { Pose } from "./pose";
import { FLOOR, type Projectile } from "./sim";

const S = 1.14;
const INK = "#0b0c0f";

const TORSO = 30;
const HEAD_R = 8.5;
const UPPER = 17;
const FORE = 16;
const THIGH = 24;
const SHIN = 25;

type V = { x: number; y: number };

const v = (x: number, y: number): V => ({ x, y });
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k });
/** Unit vector at angle `t` from straight down, positive = forward. */
const limb = (t: number): V => ({ x: Math.sin(t), y: Math.cos(t) });
const up = (t: number): V => ({ x: Math.sin(t), y: -Math.cos(t) });

interface Skeleton {
  hip: V;
  neck: V;
  shoulderF: V;
  shoulderB: V;
  head: V;
  headAngle: number;
  elbowF: V;
  handF: V;
  elbowB: V;
  handB: V;
  hipF: V;
  hipB: V;
  kneeF: V;
  footF: V;
  toeF: V;
  kneeB: V;
  footB: V;
  toeB: V;
  /** Torso axis (up) and its forward normal. */
  u: V;
  n: V;
}

function solve(p: Pose): Skeleton {
  const hip = v(p.hipDX, 0);
  const u = up(p.lean);
  const n = v(Math.cos(p.lean), Math.sin(p.lean));
  const neck = add(hip, mul(u, TORSO));
  const shoulder = add(neck, mul(u, -3));
  const shoulderF = add(shoulder, mul(n, 2.5));
  const shoulderB = add(shoulder, mul(n, -2.5));
  const headAngle = p.lean + p.head;
  const head = add(neck, mul(up(headAngle), HEAD_R + 2.5));

  const elbowF = add(shoulderF, mul(limb(p.aF[0]), UPPER));
  const handF = add(elbowF, mul(limb(p.aF[0] + p.aF[1]), FORE));
  const elbowB = add(shoulderB, mul(limb(p.aB[0]), UPPER));
  const handB = add(elbowB, mul(limb(p.aB[0] + p.aB[1]), FORE));

  const hipF = add(hip, v(2.5, 0));
  const hipB = add(hip, v(-2.5, 0));
  const kneeF = add(hipF, mul(limb(p.lF[0]), THIGH));
  const shinF = p.lF[0] - p.lF[1];
  const footF = add(kneeF, mul(limb(shinF), SHIN));
  const toeF = add(footF, mul(v(Math.cos(shinF), -Math.sin(shinF)), 7));
  const kneeB = add(hipB, mul(limb(p.lB[0]), THIGH));
  const shinB = p.lB[0] - p.lB[1];
  const footB = add(kneeB, mul(limb(shinB), SHIN));
  const toeB = add(footB, mul(v(Math.cos(shinB), -Math.sin(shinB)), 7));

  const sk: Skeleton = {
    hip, neck, shoulderF, shoulderB, head, headAngle: headAngle + p.rot,
    elbowF, handF, elbowB, handB, hipF, hipB, kneeF, footF, toeF, kneeB, footB, toeB,
    u, n,
  };
  if (p.rot !== 0) {
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    for (const k of Object.keys(sk) as (keyof Skeleton)[]) {
      if (k === "headAngle" || k === "u" || k === "n") continue;
      const pt = sk[k] as V;
      const dx = pt.x - hip.x;
      const dy = pt.y - hip.y;
      (sk[k] as V) = v(hip.x + dx * c - dy * s, hip.y + dx * s + dy * c);
    }
    sk.u = v(u.x * c - u.y * s, u.x * s + u.y * c);
    sk.n = v(n.x * c - n.y * s, n.x * s + n.y * c);
  }
  return sk;
}

/** How far below the hips the lowest point of the body hangs. */
function lowest(sk: Skeleton): number {
  return Math.max(
    sk.footF.y + 2,
    sk.footB.y + 2,
    sk.toeF.y + 1,
    sk.toeB.y + 1,
    sk.kneeF.y + 4,
    sk.kneeB.y + 4,
    sk.handF.y + 3,
    sk.handB.y + 3,
    sk.head.y + HEAD_R,
    sk.hip.y + 6,
  );
}

// ── primitives ──────────────────────────────────────────────────────────────

function capsule(ctx: CanvasRenderingContext2D, a: V, b: V, ra: number, rb: number, fill: string, light?: string) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.arc(a.x, a.y, ra, ang + Math.PI / 2, ang + (3 * Math.PI) / 2);
  ctx.arc(b.x, b.y, rb, ang - Math.PI / 2, ang + Math.PI / 2);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
  if (light) {
    // A highlight down the upper edge — where the torch light falls.
    let px = -Math.sin(ang);
    let py = Math.cos(ang);
    if (py > 0) {
      px = -px;
      py = -py;
    }
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = light;
    ctx.lineWidth = Math.min(ra, rb) * 0.55;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a.x + px * ra * 0.45, a.y + py * ra * 0.45);
    ctx.lineTo(b.x + px * rb * 0.45, b.y + py * rb * 0.45);
    ctx.stroke();
    ctx.restore();
  }
}

function circle(ctx: CanvasRenderingContext2D, c: V, r: number, fill: string, stroke = true) {
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) ctx.stroke();
}

function poly(ctx: CanvasRenderingContext2D, pts: V[], fill: string, stroke = true) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) ctx.stroke();
}

// ── body parts ──────────────────────────────────────────────────────────────

function drawLeg(ctx: CanvasRenderingContext2D, d: FighterDef, hip: V, knee: V, foot: V, toe: V, far: boolean) {
  const monk = d.style === "monk";
  const pants = monk ? (far ? d.underDark : d.under) : far ? d.dark : d.main;
  const light = monk ? "#3a3b44" : d.light;
  capsule(ctx, hip, knee, 6.2, 5, pants, far ? undefined : light);
  capsule(ctx, knee, foot, 5, 3.6, pants, far ? undefined : light);
  // Shin wraps and boot.
  const mid = add(knee, mul(add(foot, mul(knee, -1)), 0.45));
  const wrap = monk ? (far ? d.dark : d.main) : far ? d.underDark : d.under;
  capsule(ctx, mid, foot, 4.3, 3.7, wrap);
  poly(ctx, [add(foot, v(-2.5, -2)), add(toe, v(1, -1)), add(toe, v(1, 2)), add(foot, v(-3, 2.5))], far ? d.underDark : d.under);
}

function drawArm(ctx: CanvasRenderingContext2D, d: FighterDef, shoulder: V, elbow: V, hand: V, far: boolean) {
  const monk = d.style === "monk";
  const upper = monk ? (far ? d.skinDark : d.skin) : far ? d.underDark : d.under;
  const lower = monk ? (far ? d.skinDark : d.skin) : far ? d.dark : d.main;
  capsule(ctx, shoulder, elbow, 4.6, 3.8, upper, far ? undefined : monk ? "#ffd9b8" : "#3a3d45");
  capsule(ctx, elbow, hand, 3.9, 3.2, lower, far ? undefined : monk ? "#ffd9b8" : d.light);
  if (monk) {
    const wrist = add(elbow, mul(add(hand, mul(elbow, -1)), 0.62));
    capsule(ctx, wrist, add(wrist, mul(add(hand, mul(wrist, -1)), 0.55)), 3.6, 3.4, far ? d.dark : d.main);
  }
  circle(ctx, hand, 3.9, monk ? (far ? d.skinDark : d.skin) : far ? d.underDark : d.under);
  if (!far && !monk) {
    // Shoulder plate.
    circle(ctx, shoulder, 5.2, d.dark);
    ctx.save();
    ctx.globalAlpha = 0.6;
    circle(ctx, add(shoulder, v(0.8, -1.4)), 2.2, d.light, false);
    ctx.restore();
  }
}

function drawTorso(ctx: CanvasRenderingContext2D, d: FighterDef, sk: Skeleton, time: number) {
  const { hip, neck, u, n } = sk;
  const monk = d.style === "monk";
  const chest = add(neck, mul(u, -5));
  const waistB = add(hip, mul(n, -7.5));
  const waistF = add(hip, mul(n, 7.5));
  const chestF = add(chest, mul(n, 10.5));
  const chestB = add(chest, mul(n, -9.5));
  const neckF = add(neck, mul(n, 4));
  const neckB = add(neck, mul(n, -4));

  // Sash tails, behind everything else on the torso.
  const sway = Math.sin(time * 0.15) * 2.5;
  const tailRoot = add(hip, mul(n, -6));
  const tail = (len: number, off: number) =>
    poly(
      ctx,
      [
        add(tailRoot, mul(u, 1)),
        add(tailRoot, add(mul(u, -len), mul(n, -6 - off + sway))),
        add(tailRoot, add(mul(u, -len + 2), mul(n, -2 - off + sway))),
        add(tailRoot, mul(u, -2)),
      ],
      off ? d.dark : d.main,
    );
  tail(17, 2);
  tail(14, 0);

  poly(ctx, [waistB, waistF, chestF, neckF, neckB, chestB], monk ? d.skin : d.main);
  // Shade the far half.
  ctx.save();
  ctx.globalAlpha = 0.32;
  poly(ctx, [waistB, add(hip, mul(n, -1)), add(chest, mul(n, -1)), chestB], monk ? d.skinDark : d.dark, false);
  ctx.restore();

  if (monk) {
    // Pecs and abs.
    ctx.save();
    ctx.strokeStyle = d.skinDark;
    ctx.lineWidth = 1;
    const pec = add(chest, mul(u, -4));
    ctx.beginPath();
    ctx.moveTo(add(pec, mul(n, -6)).x, add(pec, mul(n, -6)).y);
    ctx.quadraticCurveTo(add(pec, mul(n, 0)).x, add(pec, add(mul(n, 0), mul(u, -3))).y, add(pec, mul(n, 8)).x, add(pec, mul(n, 8)).y);
    ctx.stroke();
    for (let i = 0; i < 3; i += 1) {
      const a = add(hip, add(mul(u, 8 + i * 5), mul(n, -2)));
      const b = add(hip, add(mul(u, 8 + i * 5), mul(n, 5)));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  } else {
    // Black under-suit at the collar, and the tunic's seam.
    poly(ctx, [neckB, neckF, add(neck, add(mul(u, -11), mul(n, 1.5)))], d.under, false);
    ctx.save();
    ctx.strokeStyle = d.dark;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const seamTop = add(neck, add(mul(u, -11), mul(n, 1.5)));
    ctx.moveTo(seamTop.x, seamTop.y);
    ctx.lineTo(add(hip, mul(n, 2)).x, add(hip, mul(n, 2)).y);
    ctx.stroke();
    // Chest highlight.
    ctx.globalAlpha = 0.45;
    poly(ctx, [add(chest, mul(n, 3)), add(chest, mul(n, 9)), add(chest, add(mul(n, 7), mul(u, -9))), add(chest, add(mul(n, 3), mul(u, -7)))], d.light, false);
    ctx.restore();
  }

  // Belt.
  poly(
    ctx,
    [add(waistB, mul(u, -1.5)), add(waistF, mul(u, -1.5)), add(waistF, mul(u, 4)), add(waistB, mul(u, 4))],
    monk ? d.main : d.under,
  );
  if (!monk) circle(ctx, add(hip, add(mul(n, 3), mul(u, 1.2))), 1.8, d.main, false);
}

function drawHead(ctx: CanvasRenderingContext2D, d: FighterDef, c: V, angle: number, time: number) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(angle);
  const r = HEAD_R;
  if (d.style === "monk") {
    // Headband tails, streaming behind.
    const sway = Math.sin(time * 0.17) * 2;
    poly(ctx, [v(-6, -4), v(-17, -1 + sway), v(-16, 2 + sway), v(-6, -1)], d.main);
    poly(ctx, [v(-6, -3), v(-14, 4 + sway), v(-12, 6 + sway), v(-6, 0)], d.dark);
    circle(ctx, v(0, 0), r, d.skin);
    // Hair.
    ctx.beginPath();
    ctx.moveTo(-r, 1);
    ctx.arc(0, 0, r, Math.PI * 0.95, Math.PI * 1.85);
    ctx.lineTo(2, -4);
    ctx.lineTo(-2, -3.5);
    ctx.lineTo(-6, -1);
    ctx.closePath();
    ctx.fillStyle = "#141114";
    ctx.fill();
    ctx.stroke();
    // Headband across the brow.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r - 0.4, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = d.main;
    ctx.fillRect(-r, -4.5, r * 2, 2.6);
    ctx.restore();
    // Ear, eye, brow, mouth.
    circle(ctx, v(-1.2, 0.8), 1.6, d.skinDark, false);
    ctx.fillStyle = "#fff";
    ctx.fillRect(3.6, -1.6, 2.6, 1.6);
    ctx.fillStyle = INK;
    ctx.fillRect(5, -1.6, 1.2, 1.6);
    ctx.fillRect(3.2, -3, 3.6, 0.9);
    ctx.fillRect(4.6, 3.4, 2.6, 0.7);
  } else {
    // Hood knot tail.
    const sway = Math.sin(time * 0.15) * 1.5;
    poly(ctx, [v(-6, -2), v(-13, 3 + sway), v(-10, 6 + sway), v(-5, 2)], d.dark);
    circle(ctx, v(0, 0), r, d.main);
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r - 0.4, 0, Math.PI * 2);
    ctx.clip();
    // Shadow on the back of the hood.
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = d.dark;
    ctx.fillRect(-r, -r, r * 0.8, r * 2);
    ctx.globalAlpha = 1;
    // Eye slit.
    ctx.fillStyle = d.skin;
    ctx.fillRect(-0.5, -3.6, r + 1, 4);
    // Mask over the mouth.
    ctx.fillStyle = d.dark;
    ctx.fillRect(-0.5, 0.4, r + 1, r);
    ctx.fillStyle = d.under;
    ctx.fillRect(-0.5, 0.4, r + 1, 1);
    ctx.restore();
    // Eyes — they glow.
    ctx.save();
    ctx.shadowColor = d.eyes;
    ctx.shadowBlur = 4;
    ctx.fillStyle = d.eyes;
    ctx.fillRect(2.2, -2.4, 2.4, 1.5);
    ctx.fillRect(5.8, -2.4, 2, 1.5);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ── public ──────────────────────────────────────────────────────────────────

export interface DrawOpts {
  /** Arena x of the fighter's centre. */
  x: number;
  /** Height above the floor. */
  y: number;
  facing: 1 | -1;
  grounded: boolean;
  flash: boolean;
  time: number;
  /** Draw a floor shadow. */
  shadow?: boolean;
  /** Override the floor line (portraits). */
  floor?: number;
  scale?: number;
}

export function drawFighter(ctx: CanvasRenderingContext2D, d: FighterDef, pose: Pose, o: DrawOpts) {
  const sk = solve(pose);
  const floor = o.floor ?? FLOOR;
  const scale = (o.scale ?? 1) * S;
  const drop = o.grounded ? lowest(sk) : 46;

  if (o.shadow !== false) {
    const lift = Math.min(1, o.y / 120);
    ctx.save();
    ctx.globalAlpha = 0.38 * (1 - lift * 0.6);
    ctx.fillStyle = "#000";
    ctx.beginPath();
    const w = (pose.rot < -1 ? 34 : 20) * (1 - lift * 0.4) * scale;
    ctx.ellipse(o.x + (pose.rot < -1 ? -o.facing * 14 : 0), floor + 1, w, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(o.x, floor - o.y);
  ctx.scale(o.facing * scale, scale);
  ctx.translate(0, -drop);
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.1;
  if (o.flash) ctx.filter = "brightness(2.6) saturate(0.3)";

  drawArm(ctx, d, sk.shoulderB, sk.elbowB, sk.handB, true);
  drawLeg(ctx, d, sk.hipB, sk.kneeB, sk.footB, sk.toeB, true);
  drawTorso(ctx, d, sk, o.time);
  drawLeg(ctx, d, sk.hipF, sk.kneeF, sk.footF, sk.toeF, false);
  drawHead(ctx, d, sk.head, sk.headAngle, o.time);
  drawArm(ctx, d, sk.shoulderF, sk.elbowF, sk.handF, false);

  ctx.restore();
}

/** A special move in flight. */
export function drawProjectile(ctx: CanvasRenderingContext2D, d: FighterDef, p: Projectile, time: number) {
  const x = p.x;
  const y = FLOOR - p.y;
  const dir = Math.sign(p.vx) || 1;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // Trail.
  for (let i = 5; i >= 1; i -= 1) {
    ctx.globalAlpha = 0.12 * (6 - i);
    ctx.fillStyle = d.special.body;
    ctx.beginPath();
    ctx.arc(x - dir * i * 5, y + Math.sin(time * 0.5 + i) * 1.5, 7 - i, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const glow = ctx.createRadialGradient(x, y, 1, x, y, 18);
  glow.addColorStop(0, d.special.glow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(x, y);
  switch (d.id) {
    case "cryo": {
      ctx.rotate(time * 0.3);
      ctx.fillStyle = d.special.body;
      ctx.strokeStyle = "#e9f7ff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        const r = i % 2 ? 4 : 9;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = d.special.core;
      ctx.fillRect(-1.5, -1.5, 3, 3);
      break;
    }
    case "kinetic": {
      ctx.fillStyle = d.special.body;
      ctx.beginPath();
      ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = d.special.core;
      ctx.beginPath();
      ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
      ctx.fill();
      // Crackle.
      ctx.strokeStyle = d.special.core;
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i += 1) {
        const a = time * 0.7 + i * 2.1;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
        ctx.lineTo(Math.cos(a + 0.4) * 10, Math.sin(a + 0.4) * 10);
        ctx.lineTo(Math.cos(a + 0.1) * 13, Math.sin(a + 0.1) * 13);
        ctx.stroke();
      }
      break;
    }
    default: {
      // Fire: a flickering teardrop that streams behind.
      const flick = Math.sin(time * 0.9) * 1.5;
      ctx.scale(dir, 1);
      ctx.fillStyle = d.special.body;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.quadraticCurveTo(4, -8 - flick, -14, -2);
      ctx.quadraticCurveTo(-6, 0, -16, 3 + flick);
      ctx.quadraticCurveTo(4, 8, 8, 0);
      ctx.fill();
      ctx.fillStyle = d.special.core;
      ctx.beginPath();
      ctx.arc(2, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
