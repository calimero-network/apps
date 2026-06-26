import { useEffect, useRef } from "react";
import { useEditorStore } from "../store/editorStore";
import { usePointerStore } from "../store/pointerStore";
import { ctx2d } from "../utils/raster";
import type { Unit } from "../types";
import styles from "./Rulers.module.css";

export const RULER_THICKNESS = 22;

// CSS reference: 96 px per inch. Percent is relative to the document dimension.
function pxPerUnit(unit: Unit, docDim: number): number {
  switch (unit) {
    case "in": return 96;
    case "cm": return 96 / 2.54;
    case "mm": return 96 / 25.4;
    case "percent": return Math.max(1, docDim) / 100;
    default: return 1; // px
  }
}

/**
 * A precision ruler drawn along the top or left edge of the canvas. Tick
 * positions track the canvas pan/zoom exactly, labels are shown in the chosen
 * unit, a lime marker follows the cursor, and dragging from the ruler onto the
 * canvas creates a guide (Photoshop/Photopea-style).
 */
export default function Ruler({ orientation }: { orientation: "h" | "v" }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const doc = useEditorStore((s) => s.doc);
  const unit = useEditorStore((s) => s.view.units);
  const px = usePointerStore((s) => s.x);
  const py = usePointerStore((s) => s.y);

  const horizontal = orientation === "h";
  const docDim = (horizontal ? doc?.width : doc?.height) ?? 1000;
  const ppu = pxPerUnit(unit, docDim);

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

      const len = horizontal ? W : H;
      const pan = horizontal ? panX : panY;
      const T = RULER_THICKNESS;

      // Choose a "nice" step in UNIT space so labels land on round numbers.
      const step = niceStep(zoom * ppu, 64);
      const sub = step / 5;
      const unitStart = (0 - pan) / (zoom * ppu);
      const unitEnd = (len - pan) / (zoom * ppu);
      const first = Math.floor(unitStart / sub) * sub;

      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.fillStyle = "#8893a3";
      ctx.font = "9px Inter, system-ui, sans-serif";
      ctx.lineWidth = 1;

      for (let u = first; u <= unitEnd; u += sub) {
        const s = Math.round(u * ppu * zoom + pan) + 0.5;
        const major = Math.abs(((u % step) + step) % step) < sub * 1e-3;
        const tick = major ? T * 0.62 : T * 0.32;
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(s, T); ctx.lineTo(s, T - tick); }
        else { ctx.moveTo(T, s); ctx.lineTo(T - tick, s); }
        ctx.stroke();
        if (major) {
          const label = formatLabel(u, step);
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

      // cursor marker (pointer position is in doc px)
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
  }, [orientation, zoom, panX, panY, px, py, ppu, horizontal]);

  // ── Drag a guide out of the ruler onto the canvas ──────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const st = useEditorStore.getState();
    const cv = document.querySelector('[data-testid="main-canvas"]') as HTMLElement | null;
    const rect = cv?.getBoundingClientRect();
    const compute = (clientX: number, clientY: number) =>
      horizontal
        ? ((clientY - (rect?.top ?? 0)) - panY) / zoom
        : ((clientX - (rect?.left ?? 0)) - panX) / zoom;
    st.addGuide(horizontal ? "h" : "v", compute(e.clientX, e.clientY));
    const gs = useEditorStore.getState().guides;
    const id = gs[gs.length - 1]?.id;
    if (!id) return;
    const move = (ev: PointerEvent) => useEditorStore.getState().moveGuide(id, compute(ev.clientX, ev.clientY));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // Released back over the ruler (negative doc coord) → discard the guide.
      if (compute(ev.clientX, ev.clientY) < 0) useEditorStore.getState().removeGuide(id);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <canvas
      ref={ref}
      className={styles.ruler}
      onPointerDown={onPointerDown}
      title="Drag onto the canvas to add a guide"
    />
  );
}

// Pick a "nice" step (1/2/5 × 10ⁿ) so labels land ~targetPx apart on screen.
// `scale` is screen px per unit.
function niceStep(scale: number, targetPx: number): number {
  const raw = targetPx / Math.max(1e-6, scale);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

function formatLabel(u: number, step: number): string {
  // Show decimals only when the step is sub-unit (e.g. inches/cm at high zoom).
  if (step >= 1) return String(Math.round(u));
  const decimals = step >= 0.1 ? 1 : 2;
  return u.toFixed(decimals);
}
