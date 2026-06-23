import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { getLayerCanvas, getMaskCanvas, peekLayerCanvas, peekMaskCanvas } from "../store/layerCanvases";
import { composite } from "../utils/compositor";
import { createCanvas, ctx2d, floodFill, hexToRgb } from "../utils/raster";
import { docToLayerLocal, normRect, selectionPathDoc, selectionPathLocal } from "../utils/geometry";
import type { Layer, Selection, TextProps } from "../types";
import styles from "./CanvasStage.module.css";

interface Props {
  /** upload the layer's pixels → update_layer_content (debounced on stroke end) */
  commitPixels: (layerId: string) => void;
  /** upload the layer's mask pixels → update_layer_mask */
  commitMaskPixels: (layerId: string) => void;
  /** persist a metadata patch → update_layer (transform/move) */
  commitMeta: (layerId: string, patch: Partial<Layer>) => void;
  /** create a new document-sized raster layer from a baked canvas (shapes/gradient) */
  onCreateRasterLayer: (opts: { name: string; x: number; y: number; canvas: HTMLCanvasElement }) => void;
  /** create a new text layer at a document point; resolves to its id */
  onCreateTextLayer: (x: number, y: number) => Promise<string | undefined>;
  /** persist edited text content + fitted size */
  onCommitText: (id: string, text: TextProps, width: number, height: number) => void;
  /** apply a document crop rect */
  onCrop: (rect: { x: number; y: number; w: number; h: number }) => void;
  /** broadcast cursor position (document space) */
  onCursorMove?: (docX: number, docY: number) => void;
  /** overlay (remote cursors) rendered above the canvas */
  overlay?: React.ReactNode;
}

type Mode =
  | "paint" | "move" | "scale" | "rotate" | "pan"
  | "marquee" | "lasso" | "crop" | "shape" | "gradient" | "clone" | "none";

interface DragState {
  mode: Mode;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  origin?: Layer;
  handle?: string;
  points?: number[]; // lasso, doc space
  cloneOffset?: { x: number; y: number }; // doc-space source - start
  cloneSnap?: HTMLCanvasElement;
}

export default function CanvasStage({
  commitPixels, commitMaskPixels, commitMeta,
  onCreateRasterLayer, onCreateTextLayer, onCommitText, onCrop,
  onCursorMove, overlay,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState>({ mode: "none", startX: 0, startY: 0, lastX: 0, lastY: 0 });
  const spaceDown = useRef(false);
  const dirtyLayer = useRef<string | null>(null);
  // live drag geometry consumed by draw() for previews (doc space)
  const live = useRef<{ mode: Mode; x0: number; y0: number; x1: number; y1: number; points?: number[] } | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const {
    doc, layers, zoom, panX, panY, renderTick,
    activeTool, selectedLayerId, editingMaskOf, editingTextId,
    primaryColor, secondaryColor, brushSize, brushHardness, brushOpacity, brushType,
    selection, shapeKind, shapeStroke, gradientType, gradientFill, cloneSource,
    setPan, setZoom, setPrimaryColor, bumpRender, canEdit, pushHistory,
    setSelection, setCloneSource, setEditingText, selectLayer,
  } = useEditorStore();

  // ── Render ──────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !doc) return;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    // HD: back the canvas with device pixels, keep CSS size in logical px.
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    void renderTick; // redraw is driven by renderTick bumps after imperative pixel edits
    const ctx = ctx2d(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    ctx.imageSmoothingEnabled = zoom < 3; // crisp pixels when zoomed in

    // checkerboard behind the document (transparency)
    drawCheckerboard(ctx, doc.width, doc.height);

    const flat = composite(layers, doc.width, doc.height, { background: doc.background });
    ctx.drawImage(flat, 0, 0);

    // document border
    ctx.imageSmoothingEnabled = true;
    ctx.strokeStyle = "rgba(165,255,17,0.35)";
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(0, 0, doc.width, doc.height);

    // selection bounding box + transform handles
    const sel = layers.find((l) => l.id === selectedLayerId);
    if (sel && (activeTool === "transform" || activeTool === "move")) {
      drawSelection(ctx, sel, zoom, activeTool === "transform");
    }

    // live previews
    drawLivePreview(ctx, live.current, zoom, primaryColor, shapeKind, shapeStroke, gradientType);

    // pixel selection marching ants
    if (selection) drawAnts(ctx, selection, zoom);

    ctx.restore();
  }, [doc, layers, zoom, panX, panY, selectedLayerId, activeTool, renderTick, selection, primaryColor, shapeKind, shapeStroke, gradientType]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [draw]);

  // keyboard: space to pan; Escape cancels crop/clone-source
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = true;
      if (e.key === "Escape") { setCropRect(null); live.current = null; draw(); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") spaceDown.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [draw]);

  // ── Coordinate helpers ────────────────────────────────────────────────────
  const screenToDoc = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
  };

  // ── Brush dab onto the active layer (or its mask) ──────────────────────────
  const paintTarget = useCallback((layer: Layer): { canvas: HTMLCanvasElement; isMask: boolean } => {
    if (editingMaskOf === layer.id) {
      return { canvas: getMaskCanvas(layer.id, layer.width, layer.height), isMask: true };
    }
    return { canvas: getLayerCanvas(layer.id, layer.width, layer.height), isMask: false };
  }, [editingMaskOf]);

  /** Clip a layer context to the active selection (in the layer's local space). */
  const clipToSelection = (ctx: CanvasRenderingContext2D, layer: Layer) => {
    if (selection) ctx.clip(selectionPathLocal(selection, layer));
  };

  const stamp = useCallback((layer: Layer, lx: number, ly: number, erase: boolean, isMask: boolean) => {
    const { canvas } = paintTarget(layer);
    const ctx = ctx2d(canvas);
    const r = brushSize / 2;
    ctx.save();
    clipToSelection(ctx, layer);
    if (erase && !isMask) ctx.globalCompositeOperation = "destination-out";
    const a = brushOpacity / 100;
    const color = isMask ? (erase ? "#000000" : "#ffffff") : primaryColor;
    const [cr, cg, cb] = hexToRgb(color);
    if (brushType === "square") {
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`;
      ctx.fillRect(lx - r, ly - r, brushSize, brushSize);
    } else {
      const grd = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
      // "soft" feathers from the hardness band outward; "round" is a hard disc.
      const inner = brushType === "round" ? 0.98 : brushHardness / 100;
      grd.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
      grd.addColorStop(Math.max(0.01, Math.min(0.99, inner)), `rgba(${cr},${cg},${cb},${a})`);
      grd.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }, [brushSize, brushHardness, brushOpacity, brushType, primaryColor, paintTarget, selection]);

  const strokeLine = useCallback((layer: Layer, x0: number, y0: number, x1: number, y1: number, erase: boolean, isMask: boolean) => {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const step = Math.max(1, brushSize / 6);
    const n = Math.max(1, Math.floor(dist / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      stamp(layer, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, erase, isMask);
    }
  }, [brushSize, stamp]);

  // ── Clone stamp dab (samples a snapshot at a fixed offset) ─────────────────
  const cloneStamp = useCallback((layer: Layer, lx: number, ly: number) => {
    const st = drag.current;
    if (!st.cloneOffset || !st.cloneSnap) return;
    const canvas = getLayerCanvas(layer.id, layer.width, layer.height);
    const ctx = ctx2d(canvas);
    const r = brushSize / 2;
    ctx.save();
    clipToSelection(ctx, layer);
    ctx.beginPath();
    ctx.arc(lx, ly, r, 0, Math.PI * 2);
    ctx.clip();
    // cloneOffset = startLocal - sourceLocal, so dest(p) samples snap(p - offset)
    ctx.drawImage(st.cloneSnap, st.cloneOffset.x, st.cloneOffset.y);
    ctx.restore();
  }, [brushSize, selection]);

  // ── Pointer handlers ───────────────────────────────────────────────────────
  const onPointerDown = async (e: React.PointerEvent) => {
    if (!doc) return;
    canvasRef.current!.setPointerCapture(e.pointerId);
    const { x, y } = screenToDoc(e);
    drag.current = { mode: "none", startX: x, startY: y, lastX: x, lastY: y };

    // pan (space or hand)
    if (spaceDown.current || activeTool === "hand") {
      drag.current.mode = "pan";
      drag.current.startX = e.clientX; drag.current.lastX = e.clientX;
      drag.current.startY = e.clientY; drag.current.lastY = e.clientY;
      return;
    }

    // zoom: click in, alt/meta-click out — keep the cursor point anchored
    if (activeTool === "zoom") {
      const rect = canvasRef.current!.getBoundingClientRect();
      const s = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = e.altKey || e.metaKey ? 1 / 1.4 : 1.4;
      const nz = Math.min(16, Math.max(0.05, zoom * factor));
      setPan(s.x - x * nz, s.y - y * nz);
      setZoom(nz);
      return;
    }

    if (activeTool === "eyedropper") {
      const flat = composite(layers, doc.width, doc.height, { background: doc.background });
      const px = ctx2d(flat).getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      setPrimaryColor("#" + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, "0")).join(""));
      return;
    }

    // selections work regardless of edit rights (they don't mutate the doc)
    if (activeTool === "marquee") {
      drag.current.mode = "marquee";
      live.current = { mode: "marquee", x0: x, y0: y, x1: x, y1: y };
      return;
    }
    if (activeTool === "lasso") {
      drag.current.mode = "lasso";
      drag.current.points = [x, y];
      live.current = { mode: "lasso", x0: x, y0: y, x1: x, y1: y, points: drag.current.points };
      return;
    }
    if (activeTool === "crop") {
      drag.current.mode = "crop";
      live.current = { mode: "crop", x0: x, y0: y, x1: x, y1: y };
      setCropRect(null);
      return;
    }

    if (!canEdit()) return;

    // text: edit an existing text layer under the cursor, else create one
    if (activeTool === "text") {
      const hit = [...layers].sort((a, b) => b.layerIndex - a.layerIndex)
        .find((l) => l.kind === "text" && x >= l.x && x <= l.x + l.width && y >= l.y && y <= l.y + l.height);
      if (hit) { selectLayer(hit.id); setEditingText(hit.id); return; }
      const id = await onCreateTextLayer(Math.round(x), Math.round(y));
      if (id) setEditingText(id);
      return;
    }

    if (activeTool === "shape") {
      drag.current.mode = "shape";
      live.current = { mode: "shape", x0: x, y0: y, x1: x, y1: y };
      return;
    }
    if (activeTool === "gradient") {
      drag.current.mode = "gradient";
      live.current = { mode: "gradient", x0: x, y0: y, x1: x, y1: y };
      return;
    }

    const sel = layers.find((l) => l.id === selectedLayerId);

    // clone stamp: alt/meta-click sets the source; otherwise paint from it
    if (activeTool === "clone" && sel) {
      if (e.altKey || e.metaKey) {
        setCloneSource({ layerId: sel.id, x, y });
        return;
      }
      if (!cloneSource) return; // need a source first
      const snap = peekLayerCanvas(cloneSource.layerId);
      if (!snap) return;
      const copy = createCanvas(snap.width, snap.height);
      ctx2d(copy).drawImage(snap, 0, 0);
      const srcLocal = docToLayerLocal(sel, cloneSource.x, cloneSource.y);
      const startLocal = docToLayerLocal(sel, x, y);
      pushHistory([sel.id]);
      dirtyLayer.current = sel.id;
      drag.current.mode = "clone";
      drag.current.cloneSnap = copy;
      drag.current.cloneOffset = { x: startLocal.x - srcLocal.x, y: startLocal.y - srcLocal.y };
      cloneStamp(sel, startLocal.x, startLocal.y);
      bumpRender();
      return;
    }

    if ((activeTool === "brush" || activeTool === "eraser") && sel) {
      pushHistory([sel.id]);
      dirtyLayer.current = sel.id;
      drag.current.mode = "paint";
      const loc = docToLayerLocal(sel, x, y);
      strokeLine(sel, loc.x, loc.y, loc.x, loc.y, activeTool === "eraser", editingMaskOf === sel.id);
      bumpRender();
      return;
    }

    if (activeTool === "bucket" && sel) {
      pushHistory([sel.id]);
      const { canvas, isMask } = paintTarget(sel);
      const loc = docToLayerLocal(sel, x, y);
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
      st.lastX = e.clientX; st.lastY = e.clientY;
      return;
    }

    // selection / crop / shape / gradient live previews
    if (st.mode === "marquee" || st.mode === "crop" || st.mode === "shape" || st.mode === "gradient") {
      if (live.current) { live.current.x1 = x; live.current.y1 = y; }
      draw();
      return;
    }
    if (st.mode === "lasso") {
      st.points?.push(x, y);
      if (live.current) { live.current.x1 = x; live.current.y1 = y; }
      draw();
      return;
    }

    const sel = layers.find((l) => l.id === selectedLayerId);
    if (!sel) return;

    if (st.mode === "clone") {
      const a = docToLayerLocal(sel, st.lastX, st.lastY);
      const b = docToLayerLocal(sel, x, y);
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const step = Math.max(1, brushSize / 6);
      const n = Math.max(1, Math.floor(dist / step));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        cloneStamp(sel, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
      st.lastX = x; st.lastY = y;
      bumpRender();
      return;
    }

    if (st.mode === "paint") {
      const a = docToLayerLocal(sel, st.lastX, st.lastY);
      const b = docToLayerLocal(sel, x, y);
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
      const sX = Math.max(5, Math.round((ox.scaleX || 100) * (1 + (x - st.startX) / Math.max(40, ox.width))));
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
    const { x, y } = screenToDoc(e);

    if (st.mode === "marquee") {
      const r = normRect(st.startX, st.startY, x, y);
      setSelection(r.w > 2 && r.h > 2 ? { kind: "rect", ...r } : null);
    } else if (st.mode === "lasso") {
      const pts = st.points ?? [];
      setSelection(pts.length >= 6 ? { kind: "poly", points: pts } : null);
    } else if (st.mode === "crop") {
      const r = normRect(st.startX, st.startY, x, y);
      setCropRect(r.w > 4 && r.h > 4 ? r : null);
    } else if (st.mode === "shape" && doc) {
      const baked = bakeShape(doc.width, doc.height, st.startX, st.startY, x, y, shapeKind, shapeStroke, primaryColor, secondaryColor, brushSize, selection);
      if (baked) onCreateRasterLayer({ name: shapeName(shapeKind), x: 0, y: 0, canvas: baked });
    } else if (st.mode === "gradient" && doc) {
      const baked = bakeGradient(doc.width, doc.height, st.startX, st.startY, x, y, gradientType, gradientFill, primaryColor, secondaryColor, selection);
      if (baked) onCreateRasterLayer({ name: "Gradient", x: 0, y: 0, canvas: baked });
    } else if ((st.mode === "paint" || st.mode === "clone") && dirtyLayer.current) {
      finishStroke(dirtyLayer.current);
      dirtyLayer.current = null;
    } else if ((st.mode === "move" || st.mode === "scale" || st.mode === "rotate") && sel) {
      commitMeta(sel.id, { x: sel.x, y: sel.y, scaleX: sel.scaleX, scaleY: sel.scaleY, rotation: sel.rotation });
    }

    live.current = null;
    drag.current = { mode: "none", startX: 0, startY: 0, lastX: 0, lastY: 0 };
    draw();
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

  const confirmCrop = () => { if (cropRect) { onCrop(cropRect); setCropRect(null); } };

  const cursor =
    drag.current.mode === "pan" || activeTool === "hand" ? "grab"
    : activeTool === "zoom" ? "zoom-in"
    : activeTool === "eyedropper" || activeTool === "bucket" ? "crosshair"
    : ["brush", "eraser", "clone", "marquee", "lasso", "crop", "shape", "gradient"].includes(activeTool) ? "crosshair"
    : activeTool === "text" ? "text"
    : "default";

  const editingText = layers.find((l) => l.id === editingTextId && l.kind === "text");

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

      {cropRect && (
        <div
          className={styles.cropBar}
          style={{ left: cropRect.x * zoom + panX, top: cropRect.y * zoom + panY - 34 }}
        >
          <span>{Math.round(cropRect.w)} × {Math.round(cropRect.h)}</span>
          <button onClick={confirmCrop}>Apply crop ⏎</button>
          <button onClick={() => setCropRect(null)}>Cancel</button>
        </div>
      )}

      {editingText && (
        <TextEditor
          layer={editingText}
          zoom={zoom}
          panX={panX}
          panY={panY}
          onCommit={(text, w, h) => { onCommitText(editingText.id, text, w, h); setEditingText(null); }}
          onCancel={() => setEditingText(null)}
        />
      )}

      {cloneSource && activeTool === "clone" && (
        <div className={styles.hint}>Clone source set — paint to stamp. Alt/⌘-click to re-sample.</div>
      )}
      {activeTool === "clone" && !cloneSource && (
        <div className={styles.hint}>Alt/⌘-click to set the clone source, then paint.</div>
      )}

      {overlay}
    </div>
  );
}

// ── Inline text editor ─────────────────────────────────────────────────────────

function TextEditor({
  layer, zoom, panX, panY, onCommit, onCancel,
}: {
  layer: Layer; zoom: number; panX: number; panY: number;
  onCommit: (text: TextProps, w: number, h: number) => void; onCancel: () => void;
}) {
  const t = layer.text!;
  const [value, setValue] = useState(t.content === "Double-click to edit" ? "" : t.content);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  const commit = () => {
    const content = value || "Text";
    // measure to fit
    const measure = createCanvas(8, 8);
    const mctx = ctx2d(measure);
    mctx.font = `${t.italic ? "italic " : ""}${t.bold ? "700 " : "400 "}${t.fontSize}px ${t.fontFamily}, sans-serif`;
    const lines = content.split("\n");
    const w = Math.max(8, ...lines.map((l) => Math.ceil(mctx.measureText(l).width))) + 8;
    const h = Math.ceil(lines.length * t.fontSize * 1.2) + 8;
    onCommit({ ...t, content }, w, h);
  };

  return (
    <textarea
      ref={ref}
      className={styles.textEditor}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
      }}
      style={{
        left: layer.x * zoom + panX,
        top: layer.y * zoom + panY,
        minWidth: Math.max(40, layer.width * zoom),
        color: t.color,
        fontSize: t.fontSize * zoom,
        fontWeight: t.bold ? 700 : 400,
        fontStyle: t.italic ? "italic" : "normal",
        fontFamily: `${t.fontFamily}, sans-serif`,
        lineHeight: 1.2,
      }}
    />
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

function drawAnts(ctx: CanvasRenderingContext2D, sel: Selection, zoom: number) {
  const path = selectionPathDoc(sel);
  ctx.save();
  ctx.lineWidth = 1 / zoom;
  ctx.strokeStyle = "#000";
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.stroke(path);
  ctx.strokeStyle = "#fff";
  ctx.lineDashOffset = 4 / zoom;
  ctx.stroke(path);
  ctx.restore();
}

function drawLivePreview(
  ctx: CanvasRenderingContext2D,
  l: { mode: Mode; x0: number; y0: number; x1: number; y1: number; points?: number[] } | null,
  zoom: number, primary: string,
  shapeKind: string, shapeStroke: boolean, gradientType: string,
) {
  if (!l) return;
  const r = normRect(l.x0, l.y0, l.x1, l.y1);
  ctx.save();
  ctx.lineWidth = 1.5 / zoom;
  if (l.mode === "marquee" || l.mode === "crop") {
    ctx.strokeStyle = l.mode === "crop" ? "rgba(255,255,255,0.9)" : "#A5FF11";
    ctx.setLineDash([5 / zoom, 4 / zoom]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  } else if (l.mode === "lasso" && l.points && l.points.length >= 4) {
    ctx.strokeStyle = "#A5FF11";
    ctx.setLineDash([5 / zoom, 4 / zoom]);
    ctx.beginPath();
    ctx.moveTo(l.points[0], l.points[1]);
    for (let i = 2; i < l.points.length; i += 2) ctx.lineTo(l.points[i], l.points[i + 1]);
    ctx.stroke();
  } else if (l.mode === "shape") {
    ctx.strokeStyle = primary;
    ctx.fillStyle = primary;
    drawShapePath(ctx, shapeKind, r);
    if (shapeStroke) ctx.stroke(); else ctx.fill();
  } else if (l.mode === "gradient") {
    ctx.strokeStyle = "#A5FF11";
    ctx.setLineDash([4 / zoom, 3 / zoom]);
    ctx.beginPath();
    ctx.moveTo(l.x0, l.y0);
    ctx.lineTo(l.x1, l.y1);
    ctx.stroke();
    void gradientType;
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
    for (const c of [p.tl, p.tr, p.bl, p.br]) ctx.fillRect(c[0] - hs / 2, c[1] - hs / 2, hs, hs);
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

// ── Shape / gradient baking ─────────────────────────────────────────────────────

function shapeName(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function drawShapePath(ctx: CanvasRenderingContext2D, kind: string, r: { x: number; y: number; w: number; h: number }) {
  ctx.beginPath();
  if (kind === "rectangle") {
    ctx.rect(r.x, r.y, r.w, r.h);
  } else if (kind === "rounded") {
    const rad = Math.min(r.w, r.h) * 0.18;
    roundRect(ctx, r.x, r.y, r.w, r.h, rad);
  } else if (kind === "ellipse") {
    ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
  } else if (kind === "line") {
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x + r.w, r.y + r.h);
  } else if (kind === "triangle") {
    ctx.moveTo(r.x + r.w / 2, r.y);
    ctx.lineTo(r.x + r.w, r.y + r.h);
    ctx.lineTo(r.x, r.y + r.h);
    ctx.closePath();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number) {
  const r = Math.min(rad, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function bakeShape(
  docW: number, docH: number, x0: number, y0: number, x1: number, y1: number,
  kind: string, stroke: boolean, primary: string, secondary: string, lineWidth: number,
  selection: Selection | null,
): HTMLCanvasElement | null {
  const r = normRect(x0, y0, x1, y1);
  if (kind === "line") { if (Math.hypot(x1 - x0, y1 - y0) < 2) return null; }
  else if (r.w < 2 || r.h < 2) return null;
  const c = createCanvas(docW, docH);
  const ctx = ctx2d(c);
  if (selection) ctx.clip(selectionPathDoc(selection));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, lineWidth / 2);
  ctx.fillStyle = primary;
  ctx.strokeStyle = secondary && secondary !== primary ? primary : primary;
  if (kind === "line") {
    ctx.strokeStyle = primary;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  } else {
    drawShapePath(ctx, kind, r);
    if (stroke) { ctx.strokeStyle = primary; ctx.stroke(); } else { ctx.fill(); }
  }
  return c;
}

function bakeGradient(
  docW: number, docH: number, x0: number, y0: number, x1: number, y1: number,
  type: string, fill: string, primary: string, secondary: string,
  selection: Selection | null,
): HTMLCanvasElement | null {
  if (Math.hypot(x1 - x0, y1 - y0) < 2) return null;
  const c = createCanvas(docW, docH);
  const ctx = ctx2d(c);
  if (selection) ctx.clip(selectionPathDoc(selection));
  let grad: CanvasGradient;
  if (type === "radial") {
    const rad = Math.hypot(x1 - x0, y1 - y0);
    grad = ctx.createRadialGradient(x0, y0, 0, x0, y0, rad);
  } else {
    grad = ctx.createLinearGradient(x0, y0, x1, y1);
  }
  const [r, g, b] = hexToRgb(primary);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  if (fill === "fg-bg") {
    const [r2, g2, b2] = hexToRgb(secondary);
    grad.addColorStop(1, `rgba(${r2},${g2},${b2},1)`);
  } else {
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, docW, docH);
  return c;
}
