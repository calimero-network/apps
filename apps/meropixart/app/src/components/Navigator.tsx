import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { composite } from "../utils/compositor";
import { createCanvas, ctx2d } from "../utils/raster";
import styles from "./Navigator.module.css";

const THUMB_MAX = 232; // max minimap dimension in CSS px

// Zoom slider runs on a log scale so 100% sits near the middle of the track.
const ZMIN = 0.05, ZMAX = 16;
const toSlider = (z: number) => (Math.log(z) - Math.log(ZMIN)) / (Math.log(ZMAX) - Math.log(ZMIN));
const fromSlider = (t: number) => Math.exp(Math.log(ZMIN) + t * (Math.log(ZMAX) - Math.log(ZMIN)));

/**
 * Photoshop-style Navigator: a downscaled live preview of the flattened
 * document, a red viewport rectangle showing what's on screen, and a zoom
 * slider. Click/drag the minimap to pan. The thumbnail is an <img> (not a
 * <canvas>) so it never disturbs the editor's canvas-count assumptions.
 */
export default function Navigator() {
  const doc = useEditorStore((s) => s.doc);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const renderTick = useEditorStore((s) => s.renderTick);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPan = useEditorStore((s) => s.setPan);

  const [thumb, setThumb] = useState<string>("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const genTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);

  // Thumbnail dimensions (CSS px) preserving the document aspect ratio.
  const ratio = doc ? Math.min(THUMB_MAX / doc.width, THUMB_MAX / doc.height, 1) : 1;
  const tw = doc ? Math.max(1, Math.round(doc.width * ratio)) : THUMB_MAX;
  const th = doc ? Math.max(1, Math.round(doc.height * ratio)) : Math.round(THUMB_MAX * 0.66);

  // Regenerate the (throttled) preview whenever the document changes.
  useEffect(() => {
    if (!doc) return;
    if (genTimer.current) clearTimeout(genTimer.current);
    genTimer.current = setTimeout(() => {
      const { layers } = useEditorStore.getState();
      const flat = composite(layers, doc.width, doc.height, { background: doc.background });
      const small = createCanvas(tw, th);
      const sctx = ctx2d(small);
      sctx.imageSmoothingEnabled = true;
      sctx.drawImage(flat, 0, 0, tw, th);
      setThumb(small.toDataURL("image/png"));
    }, 220);
    return () => { if (genTimer.current) clearTimeout(genTimer.current); };
  }, [doc, renderTick, tw, th]);

  // Viewport rectangle (red box) in thumbnail coords, from the live canvas size.
  let vp: { left: number; top: number; w: number; h: number } | null = null;
  if (doc) {
    const cv = document.querySelector('[data-testid="main-canvas"]') as HTMLElement | null;
    const rect = cv?.getBoundingClientRect();
    if (rect) {
      const docX0 = (0 - panX) / zoom;
      const docY0 = (0 - panY) / zoom;
      const docX1 = (rect.width - panX) / zoom;
      const docY1 = (rect.height - panY) / zoom;
      vp = {
        left: Math.max(0, docX0) * ratio,
        top: Math.max(0, docY0) * ratio,
        w: (Math.min(doc.width, docX1) - Math.max(0, docX0)) * ratio,
        h: (Math.min(doc.height, docY1) - Math.max(0, docY0)) * ratio,
      };
    }
  }

  // Center the view on the clicked minimap point.
  const panTo = (clientX: number, clientY: number) => {
    const wrap = wrapRef.current;
    if (!wrap || !doc) return;
    const r = wrap.getBoundingClientRect();
    const docX = ((clientX - r.left) / ratio);
    const docY = ((clientY - r.top) / ratio);
    const cv = document.querySelector('[data-testid="main-canvas"]') as HTMLElement | null;
    const vr = cv?.getBoundingClientRect();
    const vw = vr?.width ?? 600;
    const vh = vr?.height ?? 400;
    setPan(vw / 2 - docX * zoom, vh / 2 - docY * zoom);
  };

  return (
    <div className={styles.panel} data-testid="navigator-panel">
      <div className={styles.header}>
        <span className="mp-label">Navigator</span>
        <span className={styles.pct}>{Math.round(zoom * 100)}%</span>
      </div>

      <div className={styles.thumbWrap}>
        <div
          ref={wrapRef}
          className={`${styles.thumb} mp-checkerboard`}
          style={{ width: tw, height: th }}
          onPointerDown={(e) => {
            dragging.current = true;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            panTo(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => { if (dragging.current) panTo(e.clientX, e.clientY); }}
          onPointerUp={() => { dragging.current = false; }}
        >
          {thumb && <img src={thumb} alt="Document preview" draggable={false} />}
          {vp && vp.w > 0 && vp.h > 0 && (
            <div
              className={styles.viewport}
              style={{ left: vp.left, top: vp.top, width: vp.w, height: vp.h }}
            />
          )}
        </div>
      </div>

      <div className={styles.zoomRow}>
        <button type="button" aria-label="Reduce zoom" onClick={() => setZoom(zoom / 1.25)}>−</button>
        <input
          className="mp-range"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={toSlider(zoom)}
          aria-label="Zoom level"
          onChange={(e) => setZoom(fromSlider(Number(e.target.value)))}
        />
        <button type="button" aria-label="Increase zoom" onClick={() => setZoom(zoom * 1.25)}>＋</button>
      </div>
    </div>
  );
}
