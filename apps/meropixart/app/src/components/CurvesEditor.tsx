import { useCallback, useEffect, useRef, useState } from "react";
import { parseCurves, clamp } from "../utils/raster";
import type { CurvesData, CurvePoint } from "../utils/raster";
import styles from "./CurvesEditor.module.css";

interface Props {
  initial?: string;
  onApply: (curvesJson: string) => void;
  onClose: () => void;
}

type Channel = "rgb" | "r" | "g" | "b";
const CHANNELS: Channel[] = ["rgb", "r", "g", "b"];
const CHANNEL_LABEL: Record<Channel, string> = { rgb: "RGB", r: "R", g: "G", b: "B" };
const CHANNEL_COLOR: Record<Channel, string> = {
  rgb: "#E6EAEF",
  r: "#ff5d6c",
  g: "#43d17a",
  b: "#3aa0ff",
};

const SIZE = 256;
const HIT_RADIUS = 10; // px tolerance to grab a point

function identity(): CurvePoint[] {
  return [{ x: 0, y: 0 }, { x: 255, y: 255 }];
}

function seed(initial?: string): CurvesData {
  const parsed = parseCurves(initial);
  const pick = (pts?: CurvePoint[]) =>
    pts && pts.length >= 2 ? [...pts].sort((a, b) => a.x - b.x) : identity();
  return {
    rgb: pick(parsed?.rgb),
    r: pick(parsed?.r),
    g: pick(parsed?.g),
    b: pick(parsed?.b),
  };
}

// Linear interpolation between sorted points → y for a given x (0..255).
function sampleCurve(points: CurvePoint[], x: number): number {
  const pts = points;
  if (x <= pts[0].x) return pts[0].y;
  if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * t;
    }
  }
  return x;
}

export default function CurvesEditor({ initial, onApply, onClose }: Props) {
  const [data, setData] = useState<CurvesData>(() => seed(initial));
  const [channel, setChannel] = useState<Channel>("rgb");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragIdx = useRef<number | null>(null);
  const movedRef = useRef(false);

  const points = (data[channel] ?? identity());

  const setPoints = useCallback((next: CurvePoint[]) => {
    setData((d) => ({ ...d, [channel]: [...next].sort((a, b) => a.x - b.x) }));
  }, [channel]);

  // ── Draw ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // background
    ctx.fillStyle = "#0A0E13";
    ctx.fillRect(0, 0, SIZE, SIZE);

    // grid (quarters)
    ctx.strokeStyle = "#232b34";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const p = (SIZE / 4) * i + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, 0); ctx.lineTo(p, SIZE);
      ctx.moveTo(0, p); ctx.lineTo(SIZE, p);
      ctx.stroke();
    }

    // diagonal baseline
    ctx.strokeStyle = "#303a45";
    ctx.beginPath();
    ctx.moveTo(0, SIZE);
    ctx.lineTo(SIZE, 0);
    ctx.stroke();

    // curve (y axis inverted: 0 at bottom)
    ctx.strokeStyle = CHANNEL_COLOR[channel];
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= 255; x++) {
      const y = sampleCurve(points, x);
      const cx = (x / 255) * SIZE;
      const cy = SIZE - (y / 255) * SIZE;
      if (x === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // control points
    for (const pt of points) {
      const cx = (pt.x / 255) * SIZE;
      const cy = SIZE - (pt.y / 255) * SIZE;
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = CHANNEL_COLOR[channel];
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#0A0E13";
      ctx.stroke();
    }
  }, [points, channel]);

  function toCurveCoords(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * SIZE;
    const py = ((e.clientY - rect.top) / rect.height) * SIZE;
    const x = clamp(Math.round((px / SIZE) * 255), 0, 255);
    const y = clamp(Math.round((1 - py / SIZE) * 255), 0, 255);
    return { x, y };
  }

  function findHit(e: { clientX: number; clientY: number }): number {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * SIZE;
    const py = ((e.clientY - rect.top) / rect.height) * SIZE;
    for (let i = 0; i < points.length; i++) {
      const cx = (points[i].x / 255) * SIZE;
      const cy = SIZE - (points[i].y / 255) * SIZE;
      if (Math.hypot(px - cx, py - cy) <= HIT_RADIUS) return i;
    }
    return -1;
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    movedRef.current = false;
    const hit = findHit(e);
    if (hit >= 0) {
      dragIdx.current = hit;
      return;
    }
    // add a new point at click position
    const { x, y } = toCurveCoords(e);
    const next = [...points, { x, y }].sort((a, b) => a.x - b.x);
    setPoints(next);
    dragIdx.current = next.findIndex((p) => p.x === x && p.y === y);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (dragIdx.current === null) return;
    movedRef.current = true;
    const idx = dragIdx.current;
    const { x, y } = toCurveCoords(e);
    const isEndpoint = idx === 0 || idx === points.length - 1;
    const next = points.map((p, i) => {
      if (i !== idx) return p;
      // endpoints keep their x locked at 0 / 255
      if (idx === 0) return { x: 0, y };
      if (idx === points.length - 1) return { x: 255, y };
      return { x, y };
    });
    setPoints(next);
    // re-track index after sort for interior points
    if (!isEndpoint) {
      const sorted = [...next].sort((a, b) => a.x - b.x);
      dragIdx.current = sorted.findIndex((p) => p.x === x && p.y === y);
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const idx = dragIdx.current;
    dragIdx.current = null;
    if (idx === null) return;
    // dragged off-canvas → delete (interior points only)
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const outside =
      e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top || e.clientY > rect.bottom;
    const isEndpoint = idx === 0 || idx === points.length - 1;
    if (outside && !isEndpoint && movedRef.current) {
      setPoints(points.filter((_, i) => i !== idx));
    }
  }

  function resetChannel() {
    setPoints(identity());
  }

  function apply() {
    onApply(JSON.stringify(data));
    onClose();
  }

  return (
    <div className="mp-overlay" onPointerDown={onClose} data-testid="curves-overlay">
      <div
        className={`mp-modal ${styles.modal}`}
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Curves editor"
        data-testid="curves-editor"
      >
        <div className={styles.header}>
          <h2>Curves</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.tabs} role="tablist">
          {CHANNELS.map((ch) => (
            <button
              key={ch}
              type="button"
              role="tab"
              aria-selected={channel === ch}
              className={`${styles.tab} ${channel === ch ? styles.tabActive : ""}`}
              onClick={() => setChannel(ch)}
              data-testid={`curves-tab-${ch}`}
            >
              {CHANNEL_LABEL[ch]}
            </button>
          ))}
        </div>

        <div className={styles.canvasWrap}>
          <canvas
            ref={canvasRef}
            width={SIZE}
            height={SIZE}
            className={styles.canvas}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            data-testid="curves-canvas"
          />
        </div>

        <p className={styles.hint}>
          Click to add a point · drag to move · drag a point off-canvas to delete
        </p>

        <div className={styles.footer}>
          <button type="button" className="mp-btn mp-btn--ghost" onClick={resetChannel}>
            Reset
          </button>
          <div className={styles.spacer} />
          <button type="button" className="mp-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="mp-btn mp-btn--primary" onClick={apply} data-testid="curves-apply">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
