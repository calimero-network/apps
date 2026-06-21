import { useCallback, useEffect, useRef } from "react";
import { useEditorStore } from "../store/editorStore";
import { getLayerCanvas, getMaskCanvas, peekMaskCanvas } from "../store/layerCanvases";
import { composite } from "../utils/compositor";
import { ctx2d, floodFill, hexToRgb } from "../utils/raster";
import type { Layer } from "../types";
import styles from "./CanvasStage.module.css";

interface Props {
  /** upload the layer's pixels → update_layer_content (debounced on stroke end) */
  commitPixels: (layerId: string) => void;
  /** upload the layer's mask pixels → update_layer_mask */
  commitMaskPixels: (layerId: string) => void;
  /** persist a metadata patch → update_layer (transform/move) */
  commitMeta: (layerId: string, patch: Partial<Layer>) => void;
  /** broadcast cursor position (document space) */
  onCursorMove?: (docX: number, docY: number) => void;
  /** overlay (remote cursors) rendered above the canvas */
  overlay?: React.ReactNode;
}

interface DragState {
  mode: "paint" | "move" | "scale" | "rotate" | "pan" | "none";
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  origin?: Layer;
  handle?: string;
}

export default function CanvasStage({ commitPixels, commitMaskPixels, commitMeta, onCursorMove, overlay }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState>({ mode: "none", startX: 0, startY: 0, lastX: 0, lastY: 0 });
  const spaceDown = useRef(false);
  const dirtyLayer = useRef<string | null>(null);

  const {
    doc, layers, zoom, panX, panY, renderTick,
    activeTool, selectedLayerId, editingMaskOf,
    primaryColor, brushSize, brushHardness, brushOpacity,
    setPan, setZoom, setPrimaryColor, bumpRender, canEdit, pushHistory,
  } = useEditorStore();

  // ── Render ──────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !doc) return;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    void renderTick; // redraw is driven by renderTick bumps after imperative pixel edits
    const ctx = ctx2d(canvas);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = zoom < 4; // crisp pixels when zoomed in

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // checkerboard behind the document (transparency)
    drawCheckerboard(ctx, doc.width, doc.height);

    const flat = composite(layers, doc.width, doc.height, { background: doc.background });
    ctx.drawImage(flat, 0, 0);

    // document border
    ctx.strokeStyle = "rgba(165,255,17,0.25)";
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(0, 0, doc.width, doc.height);

    // selection bounding box + transform handles
    const sel = layers.find((l) => l.id === selectedLayerId);
    if (sel && (activeTool === "transform" || activeTool === "move")) {
      drawSelection(ctx, sel, zoom, activeTool === "transform");
    }
    ctx.restore();
  }, [doc, layers, zoom, panX, panY, selectedLayerId, activeTool, renderTick]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [draw]);

  // keyboard: space to pan
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === "Space") spaceDown.current = true; };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") spaceDown.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // ── Coordinate helpers ────────────────────────────────────────────────────
  const screenToDoc = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
  };

  const docToLocal = (layer: Layer, dx: number, dy: number) => {
    const sx = (layer.scaleX || 100) / 100;
    const sy = (layer.scaleY || 100) / 100;
    const cx = layer.x + (layer.width * sx) / 2;
    const cy = layer.y + (layer.height * sy) / 2;
    const x = dx - cx;
    const y = dy - cy;
    const r = (-layer.rotation * Math.PI) / 180;
    const rx = x * Math.cos(r) - y * Math.sin(r);
    const ry = x * Math.sin(r) + y * Math.cos(r);
    return { x: rx / sx + layer.width / 2, y: ry / sy + layer.height / 2 };
  };

  // ── Paint a brush dab onto the active layer (or its mask) ──────────────────
  const paintTarget = useCallback((layer: Layer): { canvas: HTMLCanvasElement; isMask: boolean } => {
    if (editingMaskOf === layer.id) {
      return { canvas: getMaskCanvas(layer.id, layer.width, layer.height), isMask: true };
    }
    return { canvas: getLayerCanvas(layer.id, layer.width, layer.height), isMask: false };
  }, [editingMaskOf]);

  const stamp = useCallback((layer: Layer, lx: number, ly: number, erase: boolean, isMask: boolean) => {
    const { canvas } = paintTarget(layer);
    const ctx = ctx2d(canvas);
    const r = brushSize / 2;
    ctx.save();
    if (erase && !isMask) {
      ctx.globalCompositeOperation = "destination-out";
    }
    const a = (brushOpacity / 100);
    let color: string;
    if (isMask) {
      // painting reveals (white) or hides (black via erase)
      color = erase ? "#000000" : "#ffffff";
    } else {
      color = primaryColor;
    }
    const [cr, cg, cb] = hexToRgb(color);
    const grd = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
    const inner = brushHardness / 100;
    grd.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
    grd.addColorStop(Math.max(0.01, inner), `rgba(${cr},${cg},${cb},${a})`);
    grd.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(lx, ly, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, [brushSize, brushHardness, brushOpacity, primaryColor, paintTarget]);

  const strokeLine = useCallback((layer: Layer, x0: number, y0: number, x1: number, y1: number, erase: boolean, isMask: boolean) => {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const step = Math.max(1, brushSize / 6);
    const n = Math.max(1, Math.floor(dist / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      stamp(layer, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, erase, isMask);
    }
  }, [brushSize, stamp]);

  // ── Pointer handlers ───────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    if (!doc) return;
    canvasRef.current!.setPointerCapture(e.pointerId);
    const { x, y } = screenToDoc(e);
    drag.current = { mode: "none", startX: x, startY: y, lastX: x, lastY: y };

    if (spaceDown.current || activeTool === "hand") {
      drag.current.mode = "pan";
      drag.current.startX = e.clientX;
      drag.current.lastX = e.clientX;
      drag.current.startY = e.clientY;
      drag.current.lastY = e.clientY;
      return;
    }

    const sel = layers.find((l) => l.id === selectedLayerId);

    if (activeTool === "eyedropper") {
      const flat = composite(layers, doc.width, doc.height, { background: doc.background });
      const px = ctx2d(flat).getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      setPrimaryColor("#" + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, "0")).join(""));
      return;
    }

    if (!canEdit()) return;

    if ((activeTool === "brush" || activeTool === "eraser") && sel) {
      pushHistory([sel.id]);
      dirtyLayer.current = sel.id;
      drag.current.mode = "paint";
      const loc = docToLocal(sel, x, y);
      strokeLine(sel, loc.x, loc.y, loc.x, loc.y, activeTool === "eraser", editingMaskOf === sel.id);
      bumpRender();
      return;
    }

    if (activeTool === "bucket" && sel) {
      pushHistory([sel.id]);
      const { canvas, isMask } = paintTarget(sel);
      const loc = docToLocal(sel, x, y);
      const [cr, cg, cb] = hexToRgb(isMask ? "#ffffff" : primaryColor);
      floodFill(ctx2d(canvas), loc.x, loc.y, [cr, cg, cb, 255], 40);
      dirtyLayer.current = sel.id;
      drag.current.mode = "none";
      bumpRender();
      finishStroke(sel.id);
      return;
    }

    if ((activeTool === "move" || activeTool === "transform") && sel) {
      const handle = activeTool === "transform" ? hitHandle(sel, x, y, zoom) : null;
      drag.current.origin = { ...sel };
      drag.current.handle = handle ?? undefined;
      drag.current.mode = handle === "rot" ? "rotate" : handle ? "scale" : "move";
      pushHistory([]);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!doc) return;
    const { x, y } = screenToDoc(e);
    onCursorMove?.(x, y);
    const st = drag.current;
    if (st.mode === "none") { st.lastX = x; st.lastY = y; return; }

    if (st.mode === "pan") {
      setPan(panX + (e.clientX - st.lastX), panY + (e.clientY - st.lastY));
      st.lastX = e.clientX;
      st.lastY = e.clientY;
      return;
    }

    const sel = layers.find((l) => l.id === selectedLayerId);
    if (!sel) return;

    if (st.mode === "paint") {
      const a = docToLocal(sel, st.lastX, st.lastY);
      const b = docToLocal(sel, x, y);
      strokeLine(sel, a.x, a.y, b.x, b.y, activeTool === "eraser", editingMaskOf === sel.id);
      st.lastX = x; st.lastY = y;
      bumpRender();
      return;
    }

    if (st.mode === "move" && st.origin) {
      const nx = Math.round(st.origin.x + (x - st.startX));
      const ny = Math.round(st.origin.y + (y - st.startY));
      useEditorStore.getState().upsertLayer({ ...sel, x: nx, y: ny });
      bumpRender();
      return;
    }

    if (st.mode === "scale" && st.origin) {
      const ox = st.origin;
      const factor = 1 + (x - st.startX) / Math.max(40, ox.width);
      const sX = Math.max(5, Math.round((ox.scaleX || 100) * factor));
      const sY = Math.max(5, Math.round((ox.scaleY || 100) * (1 + (y - st.startY) / Math.max(40, ox.height))));
      useEditorStore.getState().upsertLayer({ ...sel, scaleX: sX, scaleY: sY });
      bumpRender();
      return;
    }

    if (st.mode === "rotate" && st.origin) {
      const ox = st.origin;
      const cx = ox.x + ox.width / 2;
      const cy = ox.y + ox.height / 2;
      const ang = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
      useEditorStore.getState().upsertLayer({ ...sel, rotation: Math.round(ang) });
      bumpRender();
      return;
    }
  };

  const finishStroke = (layerId: string) => {
    if (editingMaskOf === layerId) commitMaskPixels(layerId);
    else commitPixels(layerId);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const st = drag.current;
    canvasRef.current?.releasePointerCapture(e.pointerId);
    const sel = layers.find((l) => l.id === selectedLayerId);
    if (st.mode === "paint" && dirtyLayer.current) {
      finishStroke(dirtyLayer.current);
      dirtyLayer.current = null;
    } else if ((st.mode === "move" || st.mode === "scale" || st.mode === "rotate") && sel) {
      commitMeta(sel.id, { x: sel.x, y: sel.y, scaleX: sel.scaleX, scaleY: sel.scaleY, rotation: sel.rotation });
    }
    drag.current = { mode: "none", startX: 0, startY: 0, lastX: 0, lastY: 0 };
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setZoom(zoom * factor);
    } else {
      setPan(panX - e.deltaX, panY - e.deltaY);
    }
  };

  // ensure mask canvas exists when entering mask edit
  useEffect(() => {
    if (editingMaskOf) {
      const l = layers.find((x) => x.id === editingMaskOf);
      if (l && !peekMaskCanvas(l.id)) getMaskCanvas(l.id, l.width, l.height);
    }
  }, [editingMaskOf, layers]);

  const cursor =
    drag.current.mode === "pan" || activeTool === "hand" ? "grab"
    : activeTool === "eyedropper" ? "crosshair"
    : activeTool === "brush" || activeTool === "eraser" || activeTool === "bucket" ? "crosshair"
    : "default";

  return (
    <div ref={wrapRef} className={styles.stage}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      />
      {overlay}
    </div>
  );
}

// ── Draw helpers ─────────────────────────────────────────────────────────────

function drawCheckerboard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const s = 16;
  ctx.save();
  ctx.fillStyle = "#15191f";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#1d232b";
  for (let y = 0; y < h; y += s) {
    for (let x = 0; x < w; x += s) {
      if (((x / s) + (y / s)) % 2 === 0) ctx.fillRect(x, y, s, s);
    }
  }
  ctx.restore();
}

function handlePoints(l: Layer) {
  const sx = (l.scaleX || 100) / 100;
  const sy = (l.scaleY || 100) / 100;
  const w = l.width * sx;
  const h = l.height * sy;
  return {
    cx: l.x + w / 2,
    cy: l.y + h / 2,
    tl: [l.x, l.y], tr: [l.x + w, l.y], bl: [l.x, l.y + h], br: [l.x + w, l.y + h],
    rot: [l.x + w / 2, l.y - 28],
    w, h,
  };
}

function drawSelection(ctx: CanvasRenderingContext2D, l: Layer, zoom: number, handles: boolean) {
  const p = handlePoints(l);
  ctx.save();
  ctx.translate(p.cx, p.cy);
  if (l.rotation) ctx.rotate((l.rotation * Math.PI) / 180);
  ctx.translate(-p.cx, -p.cy);
  ctx.strokeStyle = "#A5FF11";
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([4 / zoom, 3 / zoom]);
  ctx.strokeRect(l.x, l.y, p.w, p.h);
  ctx.setLineDash([]);
  if (handles) {
    const hs = 7 / zoom;
    ctx.fillStyle = "#A5FF11";
    for (const c of [p.tl, p.tr, p.bl, p.br]) {
      ctx.fillRect(c[0] - hs / 2, c[1] - hs / 2, hs, hs);
    }
    // rotate handle
    ctx.beginPath();
    ctx.moveTo(p.cx, l.y);
    ctx.lineTo(p.rot[0], p.rot[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.rot[0], p.rot[1], hs * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function hitHandle(l: Layer, x: number, y: number, zoom: number): string | null {
  const p = handlePoints(l);
  const tol = 10 / zoom;
  const near = (px: number, py: number) => Math.hypot(x - px, y - py) < tol;
  if (near(p.rot[0], p.rot[1])) return "rot";
  if (near(p.br[0], p.br[1])) return "br";
  if (near(p.tr[0], p.tr[1])) return "tr";
  if (near(p.bl[0], p.bl[1])) return "bl";
  if (near(p.tl[0], p.tl[1])) return "tl";
  return null;
}
