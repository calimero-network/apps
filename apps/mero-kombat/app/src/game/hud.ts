/**
 * The arcade HUD drawn over the arena: health bars that drain in two stages,
 * round medallions, names, and the announcer's lettering.
 */
import { W } from "./sim";

export interface HudSide {
  name: string;
  /** 0..1, what the bar shows now. */
  hp: number;
  /** 0..1, the red tail that drains after a hit. */
  trail: number;
  rounds: number;
  online: boolean;
  you: boolean;
}

const BAR_W = 188;
const BAR_H = 11;
const TOP = 14;

function bar(ctx: CanvasRenderingContext2D, x: number, side: HudSide, flip: boolean) {
  // Frame.
  ctx.fillStyle = "#0b0b0d";
  ctx.fillRect(x - 2, TOP - 2, BAR_W + 4, BAR_H + 4);
  ctx.fillStyle = "#d9b13a";
  ctx.fillRect(x - 1, TOP - 1, BAR_W + 2, BAR_H + 2);
  ctx.fillStyle = "#3a0c0c";
  ctx.fillRect(x, TOP, BAR_W, BAR_H);

  const fill = (frac: number, color: string) => {
    const w = Math.round(BAR_W * Math.max(0, Math.min(1, frac)));
    ctx.fillStyle = color;
    ctx.fillRect(flip ? x + BAR_W - w : x, TOP, w, BAR_H);
  };
  fill(side.trail, "#d8262c");
  const hpColor = side.hp > 0.5 ? "#3fdc3a" : side.hp > 0.25 ? "#e6d22a" : "#f0582a";
  fill(side.hp, hpColor);
  // Gloss.
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fillRect(x, TOP + 1, BAR_W, 3);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(x, TOP + BAR_H - 3, BAR_W, 3);

  // Name.
  ctx.font = "bold 8px ui-monospace, Menlo, monospace";
  ctx.textAlign = flip ? "right" : "left";
  const nx = flip ? x + BAR_W : x;
  const label = side.name.toUpperCase();
  ctx.fillStyle = "#000";
  ctx.fillText(label, nx + 1, TOP + BAR_H + 11);
  ctx.fillStyle = side.you ? "#a5ff11" : "#ffe9b0";
  ctx.fillText(label, nx, TOP + BAR_H + 10);

  // Round medallions.
  for (let i = 0; i < 2; i += 1) {
    const mx = flip ? x + BAR_W - 6 - i * 13 - ctx.measureText(label).width - 10 : x + ctx.measureText(label).width + 10 + i * 13;
    const my = TOP + BAR_H + 7;
    ctx.beginPath();
    ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = i < side.rounds ? "#ffcf3a" : "rgba(0,0,0,0.5)";
    ctx.fill();
    ctx.strokeStyle = i < side.rounds ? "#7a4a00" : "rgba(255,230,170,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
    if (i < side.rounds) {
      ctx.fillStyle = "#7a4a00";
      ctx.fillRect(mx - 1, my - 2, 2, 4);
    }
  }

  // Link light.
  if (!side.online) {
    ctx.font = "bold 6px ui-monospace, Menlo, monospace";
    ctx.fillStyle = "#ff8a6a";
    ctx.fillText("OFFLINE", nx, TOP + BAR_H + 19);
  }
}

export function drawHud(ctx: CanvasRenderingContext2D, left: HudSide, right: HudSide, centre: string) {
  bar(ctx, 12, left, false);
  bar(ctx, W - 12 - BAR_W, right, true);
  // Centre badge.
  ctx.fillStyle = "#0b0b0d";
  ctx.fillRect(W / 2 - 22, TOP - 3, 44, 17);
  ctx.strokeStyle = "#d9b13a";
  ctx.lineWidth = 1;
  ctx.strokeRect(W / 2 - 21.5, TOP - 2.5, 43, 16);
  ctx.font = "bold 9px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffe9b0";
  ctx.fillText(centre, W / 2, TOP + 9);
}

/**
 * The announcer: big gold lettering with a heavy outline, the way the cabinet
 * shouted at you.
 */
export function drawBanner(ctx: CanvasRenderingContext2D, text: string, sub: string, t: number, tone: "gold" | "red" | "lime" = "gold") {
  const scale = Math.min(1, 0.6 + t * 0.08);
  ctx.save();
  ctx.translate(W / 2, 112);
  ctx.scale(scale, scale);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 40px Impact, 'Arial Black', 'Helvetica Neue', sans-serif";
  const grad = ctx.createLinearGradient(0, -20, 0, 20);
  if (tone === "red") {
    grad.addColorStop(0, "#ffb0a0");
    grad.addColorStop(0.5, "#ff2a1a");
    grad.addColorStop(1, "#7a0a00");
  } else if (tone === "lime") {
    grad.addColorStop(0, "#f2ffd0");
    grad.addColorStop(0.5, "#a5ff11");
    grad.addColorStop(1, "#3f6a00");
  } else {
    grad.addColorStop(0, "#fff6c8");
    grad.addColorStop(0.5, "#ffc21a");
    grad.addColorStop(1, "#9a4a00");
  }
  ctx.lineJoin = "round";
  ctx.lineWidth = 7;
  ctx.strokeStyle = "#000";
  ctx.strokeText(text, 0, 0);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#5a1a00";
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = grad;
  ctx.fillText(text, 0, 0);
  if (sub) {
    ctx.font = "900 14px Impact, 'Arial Black', sans-serif";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#000";
    ctx.strokeText(sub, 0, 30);
    ctx.fillStyle = "#ffe9b0";
    ctx.fillText(sub, 0, 30);
  }
  ctx.restore();
}

/** A small caption across the bottom of the screen. */
export function drawCaption(ctx: CanvasRenderingContext2D, text: string) {
  ctx.save();
  ctx.font = "bold 8px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  const w = ctx.measureText(text).width + 16;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(Math.round(W / 2 - w / 2), 250, Math.round(w), 13);
  ctx.fillStyle = "#ffe9b0";
  ctx.fillText(text, W / 2, 259);
  ctx.restore();
}
