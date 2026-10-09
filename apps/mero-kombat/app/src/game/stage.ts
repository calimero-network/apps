/**
 * The arena: a temple courtyard at night under a blood moon.
 *
 * The still parts are painted once into an offscreen canvas; braziers, embers
 * and drifting mist are drawn on top every frame.
 */
import { FLOOR, H, W } from "./sim";

let cached: HTMLCanvasElement | null = null;

/** Deterministic noise, so the stars and stones are the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function paintStatic(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const rand = rng(7);

  // Sky.
  const sky = ctx.createLinearGradient(0, 0, 0, 170);
  sky.addColorStop(0, "#0b0618");
  sky.addColorStop(0.45, "#2a0d2e");
  sky.addColorStop(0.8, "#6e1c26");
  sky.addColorStop(1, "#b2452a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, 175);

  // Stars.
  for (let i = 0; i < 70; i += 1) {
    ctx.globalAlpha = 0.3 + rand() * 0.7;
    ctx.fillStyle = "#fff6e8";
    ctx.fillRect(Math.floor(rand() * W), Math.floor(rand() * 90), 1, 1);
  }
  ctx.globalAlpha = 1;

  // Blood moon.
  const mx = 362;
  const my = 58;
  const halo = ctx.createRadialGradient(mx, my, 20, mx, my, 80);
  halo.addColorStop(0, "rgba(255,140,90,0.35)");
  halo.addColorStop(1, "rgba(255,80,40,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(mx - 80, my - 80, 160, 160);
  const moon = ctx.createRadialGradient(mx - 8, my - 8, 4, mx, my, 28);
  moon.addColorStop(0, "#ffd9b0");
  moon.addColorStop(0.7, "#f29a6a");
  moon.addColorStop(1, "#c4573a");
  ctx.fillStyle = moon;
  ctx.beginPath();
  ctx.arc(mx, my, 27, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(150,60,40,0.35)";
  for (const [dx, dy, r] of [[-8, -6, 5], [7, 4, 7], [-4, 12, 3], [12, -10, 3]] as const) {
    ctx.beginPath();
    ctx.arc(mx + dx, my + dy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Far mountains.
  const ridge = (base: number, amp: number, color: string, seed: number) => {
    const r = rng(seed);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 175);
    let y = base;
    for (let x = 0; x <= W; x += 12) {
      y = Math.max(base - amp, Math.min(base + amp * 0.3, y + (r() - 0.5) * amp * 0.9));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, 175);
    ctx.closePath();
    ctx.fill();
  };
  ridge(120, 40, "#3a1424", 3);
  ridge(140, 30, "#2a0e1c", 11);

  // A pagoda on the far ridge.
  ctx.fillStyle = "#1c0913";
  const px = 92;
  for (let i = 0; i < 4; i += 1) {
    const w = 34 - i * 7;
    const y = 128 - i * 11;
    ctx.beginPath();
    ctx.moveTo(px - w / 2 - 5, y);
    ctx.quadraticCurveTo(px, y - 6, px + w / 2 + 5, y);
    ctx.lineTo(px + w / 2 - 2, y - 4);
    ctx.lineTo(px - w / 2 + 2, y - 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(px - w / 2 + 4, y - 1, w - 8, 12);
  }
  ctx.fillRect(px - 1, 80, 2, 8);

  // Back wall: stone blocks with a crenellated top.
  const wallTop = 150;
  const wallBottom = 200;
  const wall = ctx.createLinearGradient(0, wallTop, 0, wallBottom);
  wall.addColorStop(0, "#4b3a3f");
  wall.addColorStop(1, "#2a2026");
  ctx.fillStyle = wall;
  ctx.fillRect(0, wallTop, W, wallBottom - wallTop);
  for (let x = 0; x < W; x += 24) {
    ctx.fillRect(x, wallTop - 8, 14, 8);
  }
  ctx.strokeStyle = "rgba(10,6,8,0.55)";
  ctx.lineWidth = 1;
  for (let row = 0; row < 5; row += 1) {
    const y = wallTop + row * 10;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
    for (let x = (row % 2) * 12; x < W; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y);
      ctx.lineTo(x + 0.5, y + 10);
      ctx.stroke();
    }
  }
  // Moss and wear.
  for (let i = 0; i < 90; i += 1) {
    ctx.fillStyle = rand() > 0.5 ? "rgba(255,220,200,0.06)" : "rgba(0,0,0,0.15)";
    ctx.fillRect(Math.floor(rand() * W), wallTop + Math.floor(rand() * 50), 2 + Math.floor(rand() * 4), 1);
  }

  // The gate in the middle of the wall, and the Calimero banners either side.
  ctx.fillStyle = "#140c10";
  ctx.beginPath();
  ctx.moveTo(214, wallBottom);
  ctx.lineTo(214, 168);
  ctx.quadraticCurveTo(240, 150, 266, 168);
  ctx.lineTo(266, wallBottom);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#3a1018";
  ctx.fillRect(200, 140, 80, 6);
  ctx.fillRect(196, 136, 88, 4);
  for (const bx of [150, 314]) banner(ctx, bx, 150);

  // Pillars that carry the braziers.
  for (const x of [34, 446]) pillar(ctx, x);

  // Floor: stone flags in perspective, toward a vanishing point at the gate.
  const floorTop = 200;
  const floor = ctx.createLinearGradient(0, floorTop, 0, H);
  floor.addColorStop(0, "#3d2a2c");
  floor.addColorStop(0.5, "#5a3d38");
  floor.addColorStop(1, "#2a1c1e");
  ctx.fillStyle = floor;
  ctx.fillRect(0, floorTop, W, H - floorTop);
  ctx.strokeStyle = "rgba(15,8,10,0.6)";
  for (let i = -12; i <= 12; i += 1) {
    ctx.beginPath();
    ctx.moveTo(240 + i * 22, floorTop);
    ctx.lineTo(240 + i * 70, H);
    ctx.stroke();
  }
  for (const y of [206, 214, 225, 240, 258]) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }
  // Moonlight pooled on the floor.
  const pool = ctx.createRadialGradient(300, 236, 10, 300, 236, 170);
  pool.addColorStop(0, "rgba(255,170,120,0.16)");
  pool.addColorStop(1, "rgba(255,170,120,0)");
  ctx.fillStyle = pool;
  ctx.fillRect(0, floorTop, W, H - floorTop);
  // Old stains.
  for (let i = 0; i < 6; i += 1) {
    ctx.fillStyle = "rgba(90,10,14,0.35)";
    ctx.beginPath();
    ctx.ellipse(40 + rand() * 400, 220 + rand() * 40, 4 + rand() * 9, 1.5 + rand() * 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Vignette.
  const vig = ctx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 300);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  return c;
}

function banner(ctx: CanvasRenderingContext2D, x: number, top: number) {
  ctx.fillStyle = "#16120f";
  ctx.fillRect(x - 13, top - 4, 26, 3);
  ctx.fillStyle = "#1d1f22";
  ctx.beginPath();
  ctx.moveTo(x - 11, top - 1);
  ctx.lineTo(x + 11, top - 1);
  ctx.lineTo(x + 11, top + 38);
  ctx.lineTo(x, top + 32);
  ctx.lineTo(x - 11, top + 38);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#a5ff11";
  ctx.lineWidth = 1;
  ctx.stroke();
  // The mark: a lime ring with a notch — the C of Calimero.
  ctx.beginPath();
  ctx.arc(x, top + 15, 6.5, Math.PI * 0.28, Math.PI * 1.72);
  ctx.lineWidth = 3;
  ctx.stroke();
}

function pillar(ctx: CanvasRenderingContext2D, x: number) {
  const g = ctx.createLinearGradient(x - 11, 0, x + 11, 0);
  g.addColorStop(0, "#2a1f22");
  g.addColorStop(0.4, "#6a5354");
  g.addColorStop(1, "#1f1619");
  ctx.fillStyle = g;
  ctx.fillRect(x - 10, 130, 20, 80);
  ctx.fillStyle = "#3a2c2e";
  ctx.fillRect(x - 13, 206, 26, 6);
  ctx.fillRect(x - 13, 126, 26, 6);
  // Bowl.
  ctx.fillStyle = "#24191a";
  ctx.beginPath();
  ctx.moveTo(x - 15, 118);
  ctx.lineTo(x + 15, 118);
  ctx.lineTo(x + 9, 127);
  ctx.lineTo(x - 9, 127);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#e0a040";
  ctx.fillRect(x - 15, 117, 30, 2);
}

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

const embers: Ember[] = [];

/** Draw the arena for this frame. */
export function drawStage(ctx: CanvasRenderingContext2D, time: number) {
  cached ??= paintStatic();
  ctx.drawImage(cached, 0, 0);

  for (const x of [34, 446]) {
    // Light thrown on the wall.
    const glow = ctx.createRadialGradient(x, 112, 4, x, 112, 70);
    const flick = 0.22 + Math.sin(time * 0.31 + x) * 0.04 + Math.sin(time * 0.77) * 0.03;
    glow.addColorStop(0, `rgba(255,160,60,${flick})`);
    glow.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - 70, 42, 140, 140);
    // Flame.
    for (let i = 0; i < 3; i += 1) {
      const h = 16 + Math.sin(time * 0.4 + i * 2 + x) * 4 - i * 4;
      const w = 10 - i * 3;
      ctx.fillStyle = ["#d23a12", "#ff8a1e", "#ffe27a"][i];
      ctx.beginPath();
      ctx.moveTo(x - w, 118);
      ctx.quadraticCurveTo(x - w * 0.6, 118 - h * 0.6, x + Math.sin(time * 0.5 + i) * 2, 118 - h);
      ctx.quadraticCurveTo(x + w * 0.6, 118 - h * 0.6, x + w, 118);
      ctx.closePath();
      ctx.fill();
    }
    if (Math.random() < 0.25) {
      embers.push({ x: x + (Math.random() - 0.5) * 10, y: 104, vx: (Math.random() - 0.5) * 0.4, vy: -0.4 - Math.random() * 0.6, life: 60 + Math.random() * 60 });
    }
  }

  for (let i = embers.length - 1; i >= 0; i -= 1) {
    const e = embers[i];
    e.x += e.vx + Math.sin((time + i) * 0.05) * 0.15;
    e.y += e.vy;
    e.life -= 1;
    if (e.life <= 0) {
      embers.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = Math.min(1, e.life / 40);
    ctx.fillStyle = e.life > 50 ? "#ffd27a" : "#ff6a2a";
    ctx.fillRect(Math.round(e.x), Math.round(e.y), 1, 1);
  }
  ctx.globalAlpha = 1;

  // Low mist rolling over the floor.
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = "#ffd8c8";
  for (let i = 0; i < 4; i += 1) {
    const x = ((time * (0.15 + i * 0.05) + i * 140) % (W + 200)) - 100;
    ctx.beginPath();
    ctx.ellipse(x, FLOOR + 6 + i * 5, 90, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
