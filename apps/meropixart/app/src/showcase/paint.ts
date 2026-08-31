// ── Paint-op renderer ────────────────────────────────────────────────────────
//
// Turns a showcase layer's recipe (see ./types) into pixels on a canvas. Nothing
// here knows about the contract or the store — give it ops and a size, get a
// canvas back — which is what lets the picker render live thumbnails with the
// same code that produces the real document.

import { createCanvas, ctx2d } from "../utils/raster";
import type { PaintOp, Shadow, Stop } from "./types";

/** Render a recipe into a fresh transparent canvas. */
export function paintCanvas(ops: PaintOp[], width: number, height: number): HTMLCanvasElement {
  const c = createCanvas(width, height);
  runOps(ctx2d(c), ops, c.width, c.height);
  return c;
}

/** Run ops onto an existing context (used by `clip`, which recurses). */
export function runOps(
  ctx: CanvasRenderingContext2D, ops: PaintOp[], width: number, height: number,
): void {
  for (const op of ops) runOp(ctx, op, width, height);
}

function runOp(
  ctx: CanvasRenderingContext2D, op: PaintOp, width: number, height: number,
): void {
  ctx.save();
  switch (op.op) {
    case "fill": {
      ctx.fillStyle = op.color;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case "linear": {
      ctx.fillStyle = linear(ctx, op.from, op.to, op.stops);
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case "radial": {
      const g = ctx.createRadialGradient(op.at[0], op.at[1], op.r0, op.at[0], op.at[1], op.r1);
      addStops(g, op.stops);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case "rect": {
      applyAlpha(ctx, op.alpha);
      applyShadow(ctx, op.shadow);
      ctx.beginPath();
      if (op.radius) roundRect(ctx, op.x, op.y, op.w, op.h, op.radius);
      else ctx.rect(op.x, op.y, op.w, op.h);
      paintPath(ctx, op.color, op.stroke, op.width);
      break;
    }
    case "ellipse": {
      applyAlpha(ctx, op.alpha);
      applyShadow(ctx, op.shadow);
      ctx.beginPath();
      ctx.ellipse(op.cx, op.cy, Math.abs(op.rx), Math.abs(op.ry),
        ((op.rotate ?? 0) * Math.PI) / 180, 0, Math.PI * 2);
      paintPath(ctx, op.color, op.stroke, op.width);
      break;
    }
    case "polygon": {
      applyAlpha(ctx, op.alpha);
      applyShadow(ctx, op.shadow);
      const p = op.points;
      if (p.length >= 4) {
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
        if (op.close !== false) ctx.closePath();
        paintPath(ctx, op.color, op.stroke, op.width);
      }
      break;
    }
    case "path": {
      applyAlpha(ctx, op.alpha);
      applyShadow(ctx, op.shadow);
      const path = new Path2D(op.d);
      const style = op.gradient
        ? linear(ctx, op.gradient.from, op.gradient.to, op.gradient.stops)
        : op.color;
      if (op.stroke) {
        ctx.strokeStyle = style;
        ctx.lineWidth = op.width ?? 2;
        ctx.lineCap = op.cap ?? "round";
        ctx.lineJoin = op.join ?? "round";
        ctx.stroke(path);
      } else {
        ctx.fillStyle = style;
        ctx.fill(path);
      }
      break;
    }
    case "line": {
      applyAlpha(ctx, op.alpha);
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width ?? 2;
      ctx.lineCap = op.cap ?? "butt";
      if (op.dash) ctx.setLineDash(op.dash);
      ctx.beginPath();
      ctx.moveTo(op.from[0], op.from[1]);
      ctx.lineTo(op.to[0], op.to[1]);
      ctx.stroke();
      break;
    }
    case "text": {
      applyAlpha(ctx, op.alpha);
      applyShadow(ctx, op.shadow);
      const family = op.font ?? "Inter";
      ctx.font = `${op.italic ? "italic " : ""}${op.weight ?? 700} ${op.size}px ${family}, sans-serif`;
      ctx.textBaseline = "top";
      ctx.textAlign = op.align ?? "left";
      ctx.fillStyle = op.gradient
        ? linear(ctx, op.gradient.from, op.gradient.to, op.gradient.stops)
        : op.color;
      if (typeof ctx.letterSpacing === "string" && op.tracking != null) {
        ctx.letterSpacing = `${op.tracking}px`;
      }
      const lh = op.lineHeight ?? op.size * 1.15;
      op.text.split("\n").forEach((line, i) => {
        // Fall back to manual tracking where `letterSpacing` is unsupported, so
        // the wide-tracked labels still look intentional rather than cramped.
        if (op.tracking && typeof ctx.letterSpacing !== "string") {
          drawTracked(ctx, line, op.x, op.y + i * lh, op.tracking, op.align ?? "left");
        } else {
          ctx.fillText(line, op.x, op.y + i * lh);
        }
      });
      break;
    }
    case "grid": {
      applyAlpha(ctx, op.alpha);
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width ?? 1;
      const step = Math.max(2, op.step);
      ctx.beginPath();
      for (let x = 0; x <= width; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); }
      for (let y = 0; y <= height; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); }
      ctx.stroke();
      break;
    }
    case "dots": {
      applyAlpha(ctx, op.alpha);
      ctx.fillStyle = op.color;
      const step = Math.max(2, op.step);
      for (let y = step / 2; y < height; y += step) {
        for (let x = step / 2; x < width; x += step) {
          ctx.beginPath();
          ctx.arc(x, y, op.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case "stripes": {
      applyAlpha(ctx, op.alpha);
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width;
      const pitch = op.width + op.gap;
      const diag = Math.hypot(width, height);
      ctx.translate(width / 2, height / 2);
      ctx.rotate((op.angle * Math.PI) / 180);
      ctx.beginPath();
      for (let x = -diag; x <= diag; x += pitch) {
        ctx.moveTo(x, -diag);
        ctx.lineTo(x, diag);
      }
      ctx.stroke();
      break;
    }
    case "rings": {
      applyAlpha(ctx, op.alpha);
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width ?? 2;
      for (let r = op.from; r <= op.to; r += Math.max(2, op.step)) {
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case "noise": {
      drawNoise(ctx, width, height, op.amount, op.mono ?? true, op.seed ?? 1, op.alpha ?? 1);
      break;
    }
    case "blur": {
      // Re-draw the layer through a blur filter. A canvas cannot filter itself
      // in place, so bounce through a scratch copy.
      const scratch = createCanvas(width, height);
      ctx2d(scratch).drawImage(ctx.canvas, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.filter = `blur(${op.radius}px)`;
      ctx.drawImage(scratch, 0, 0);
      ctx.filter = "none";
      break;
    }
    case "clip": {
      // Use the nested ops as a stencil over what is already there: "in" keeps
      // only the overlap, "out" punches it away. Both are `destination-*`
      // operators — `source-in` would keep the stencil's own COLOUR and repaint
      // the artwork with it, which is not masking, it is flood-filling.
      const scratch = createCanvas(width, height);
      runOps(ctx2d(scratch), op.ops, width, height);
      ctx.globalCompositeOperation = op.mode === "in" ? "destination-in" : "destination-out";
      ctx.drawImage(scratch, 0, 0);
      break;
    }
  }
  ctx.restore();
}

function paintPath(
  ctx: CanvasRenderingContext2D, color: string, stroke?: boolean, width?: number,
) {
  if (stroke) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width ?? 2;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function linear(
  ctx: CanvasRenderingContext2D, from: [number, number], to: [number, number], stops: Stop[],
): CanvasGradient {
  const g = ctx.createLinearGradient(from[0], from[1], to[0], to[1]);
  addStops(g, stops);
  return g;
}

function addStops(g: CanvasGradient, stops: Stop[]) {
  for (const [offset, color] of stops) {
    g.addColorStop(Math.max(0, Math.min(1, offset)), color);
  }
}

function applyAlpha(ctx: CanvasRenderingContext2D, alpha?: number) {
  if (alpha != null) ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
}

function applyShadow(ctx: CanvasRenderingContext2D, shadow?: Shadow) {
  if (!shadow) return;
  ctx.shadowBlur = shadow.blur;
  ctx.shadowColor = shadow.color;
  ctx.shadowOffsetX = shadow.offset?.[0] ?? 0;
  ctx.shadowOffsetY = shadow.offset?.[1] ?? 0;
}

export function roundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number,
) {
  const r = Math.min(rad, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Manual letter spacing, for engines without `ctx.letterSpacing`. */
function drawTracked(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  tracking: number, align: CanvasTextAlign,
) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, text.length - 1);
  let cursor = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  const prev = ctx.textAlign;
  ctx.textAlign = "left";
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, cursor, y);
    cursor += widths[i] + tracking;
  });
  ctx.textAlign = prev;
}

/**
 * Deterministic grain. A seeded xorshift rather than Math.random, so the same
 * showcase renders identically for every peer — a document whose grain differed
 * per machine would show up as a permanent diff in the layer's blob.
 */
function drawNoise(
  ctx: CanvasRenderingContext2D, width: number, height: number,
  amount: number, mono: boolean, seed: number, alpha: number,
) {
  const img = ctx.createImageData(width, height);
  const d = img.data;
  let state = (seed | 0) || 1;
  const next = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const a = Math.round(255 * Math.max(0, Math.min(1, alpha)));
  for (let i = 0; i < d.length; i += 4) {
    if (mono) {
      const v = Math.round(255 * next() * amount);
      d[i] = d[i + 1] = d[i + 2] = v;
    } else {
      d[i] = Math.round(255 * next() * amount);
      d[i + 1] = Math.round(255 * next() * amount);
      d[i + 2] = Math.round(255 * next() * amount);
    }
    d[i + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
}
