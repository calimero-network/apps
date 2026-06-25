import { useEffect, useRef } from "react";
import { useEditorStore } from "../store/editorStore";
import { usePointerStore } from "../store/pointerStore";
import { ctx2d } from "../utils/raster";
import styles from "./Rulers.module.css";

export const RULER_THICKNESS = 22;

/**
 * A precision ruler drawn along the top or left edge of the canvas. Tick
 * positions track the canvas pan/zoom exactly (docCoord * zoom + pan), and a
 * lime marker follows the cursor — Photoshop/Photopea-style.
 */
export default function Ruler({ orientation }: { orientation: "h" | "v" }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const px = usePointerStore((s) => s.x);
  const py = usePointerStore((s) => s.y);

  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = parent.clientWidth;
      const H = parent.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      const ctx = ctx2d(canvas);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#15191f";
      ctx.fillRect(0, 0, W, H);

      const horizontal = orientation === "h";
      const len = horizontal ? W : H;
      const pan = horizontal ? panX : panY;
      const T = RULER_THICKNESS;

      const step = niceStep(zoom, 64);
      const sub = step / 5;
      const docStart = (0 - pan) / zoom;
      const docEnd = (len - pan) / zoom;
      const first = Math.floor(docStart / sub) * sub;

      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.fillStyle = "#8893a3";
      ctx.font = "9px Inter, system-ui, sans-serif";
      ctx.lineWidth = 1;

      for (let d = first; d <= docEnd; d += sub) {
        const s = Math.round(d * zoom + pan) + 0.5;
        const major = Math.abs(((d % step) + step) % step) < 1e-6;
        const tick = major ? T * 0.62 : T * 0.32;
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(s, T); ctx.lineTo(s, T - tick); }
        else { ctx.moveTo(T, s); ctx.lineTo(T - tick, s); }
        ctx.stroke();
        if (major) {
          const label = String(Math.round(d));
          if (horizontal) {
            ctx.fillText(label, s + 3, 9);
          } else {
            ctx.save();
            ctx.translate(9, s - 3);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(label, 0, 0);
            ctx.restore();
          }
        }
      }

      // cursor marker
      const p = horizontal ? px : py;
      if (p != null) {
        const s = Math.round(p * zoom + pan) + 0.5;
        ctx.strokeStyle = "#A5FF11";
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(s, 0); ctx.lineTo(s, T); }
        else { ctx.moveTo(0, s); ctx.lineTo(T, s); }
        ctx.stroke();
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [orientation, zoom, panX, panY, px, py]);

  return <canvas ref={ref} className={styles.ruler} />;
}

// Pick a "nice" doc-space step (1/2/5 × 10ⁿ) so labels land ~targetPx apart.
function niceStep(zoom: number, targetPx: number): number {
  const raw = targetPx / zoom;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}
