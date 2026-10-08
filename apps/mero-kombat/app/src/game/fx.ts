/**
 * Sparks, blood, dust, and the little "TX ✓" tags that float off a fighter
 * when one of their blows is confirmed by the node.
 */
import { FLOOR } from "./sim";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  gravity: number;
  /** Streak: drawn as a line along velocity. */
  streak: boolean;
}

interface Tag {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

export class Fx {
  private parts: Particle[] = [];
  private tags: Tag[] = [];
  /** Frames of screen shake left, and its strength. */
  shake = 0;
  private shakeAmp = 0;

  hit(x: number, y: number, blocked: boolean, heavy: boolean) {
    const sy = FLOOR - y;
    const n = blocked ? 10 : heavy ? 26 : 16;
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * (heavy ? 4.5 : 3);
      this.parts.push({
        x, y: sy,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 10 + Math.random() * 8,
        max: 18,
        color: blocked ? (Math.random() > 0.5 ? "#fff7c2" : "#ffd23a") : Math.random() > 0.4 ? "#fff3d6" : "#ffb03a",
        size: 1,
        gravity: 0,
        streak: true,
      });
    }
    if (!blocked) {
      // The arcade's signature: a spray that arcs and falls.
      for (let i = 0; i < (heavy ? 22 : 12); i += 1) {
        this.parts.push({
          x, y: sy,
          vx: (Math.random() - 0.5) * 5,
          vy: -1.5 - Math.random() * 3.5,
          life: 40 + Math.random() * 30,
          max: 70,
          color: Math.random() > 0.3 ? "#b3121c" : "#e0283a",
          size: 1 + Math.floor(Math.random() * 2),
          gravity: 0.22,
          streak: false,
        });
      }
    }
    this.kick(blocked ? 3 : heavy ? 9 : 5, blocked ? 1.2 : heavy ? 3.2 : 2);
  }

  dust(x: number) {
    for (let i = 0; i < 8; i += 1) {
      this.parts.push({
        x: x + (Math.random() - 0.5) * 16,
        y: FLOOR - 1,
        vx: (Math.random() - 0.5) * 1.6,
        vy: -Math.random() * 0.9,
        life: 18 + Math.random() * 10,
        max: 28,
        color: "#a88f80",
        size: 2,
        gravity: 0.02,
        streak: false,
      });
    }
  }

  tag(x: number, y: number, text: string, color: string) {
    this.tags.push({ x, y: FLOOR - y, text, color, life: 70 });
    if (this.tags.length > 12) this.tags.shift();
  }

  kick(frames: number, amp: number) {
    this.shake = Math.max(this.shake, frames);
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  /** Camera offset this frame. */
  offset(): [number, number] {
    if (this.shake <= 0) {
      this.shakeAmp = 0;
      return [0, 0];
    }
    this.shake -= 1;
    const a = this.shakeAmp * (this.shake / 10 + 0.3);
    return [Math.round((Math.random() - 0.5) * a * 2), Math.round((Math.random() - 0.5) * a * 2)];
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (let i = this.parts.length - 1; i >= 0; i -= 1) {
      const p = this.parts[i];
      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      if (!p.streak && p.y > FLOOR + 6) {
        // Splat and stay a moment.
        p.y = FLOOR + 6;
        p.vx = 0;
        p.vy = 0;
        p.gravity = 0;
      }
      p.life -= 1;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.min(1, p.life / 10);
      if (p.streak) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 2, p.y - p.vy * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;

    ctx.font = "bold 7px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    for (let i = this.tags.length - 1; i >= 0; i -= 1) {
      const t = this.tags[i];
      t.life -= 1;
      t.y -= 0.35;
      if (t.life <= 0) {
        this.tags.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.min(1, t.life / 20);
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      const w = ctx.measureText(t.text).width + 6;
      ctx.fillRect(Math.round(t.x - w / 2), Math.round(t.y - 7), Math.round(w), 9);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, Math.round(t.x), Math.round(t.y));
    }
    ctx.globalAlpha = 1;
  }

  clear() {
    this.parts = [];
    this.tags = [];
    this.shake = 0;
  }
}
