import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore, type ViewSettings } from "../store/editorStore";
import { usePointerStore } from "../store/pointerStore";
import { getLayerCanvas, getMaskCanvas, peekLayerCanvas, peekMaskCanvas } from "../store/layerCanvases";
import { composite } from "../utils/compositor";
import { createCanvas, ctx2d, hexToRgb } from "../utils/raster";
import { docToLayerLocal, normRect, selectionPathDoc, selectionPathLocal } from "../utils/geometry";
import {
  boxSize, centerOf, cornersOf, scaleOf, serializeWarp, unionBounds, warpOf,
} from "../utils/transform";
import { handlePoints, hitHandle, scaleSigns, type HandleName } from "../utils/gizmo";
import { groupBounds, movableLayers } from "../utils/layerTree";
import type { DocumentInfo, Guide, Layer, Selection, TextProps, WarpCorners } from "../types";
import styles from "./CanvasStage.module.css";

// ── Snapping ────────────────────────────────────────────────────────────────
/** Snap target coordinates along an axis: doc edges + center, guides, grid. */
function snapCandidates(orient: "h" | "v", doc: DocumentInfo, view: ViewSettings, guides: Guide[]): number[] {
  const max = orient === "v" ? doc.width : doc.height;
  const out = [0, max, max / 2];
  for (const g of guides) if (g.orient === (orient === "v" ? "v" : "h")) out.push(g.pos);
  if (view.showGrid) {
    for (let p = 0; p <= max; p += Math.max(2, view.gridSize)) out.push(p);
  }
  return out;
}

/** Rotate a vector by `deg` degrees — screen axes → layer axes and back. */
function rotateVec(x: number, y: number, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/** Smallest offset that snaps any reference point onto a candidate within tol. */
function bestSnapDelta(refs: number[], candidates: number[], tol: number): number {
  let best = 0;
  let bestAbs = tol;
  for (const ref of refs) {
    for (const c of candidates) {
      const d = c - ref;
      if (Math.abs(d) < bestAbs) { bestAbs = Math.abs(d); best = d; }
    }
  }
  return best;
}

interface Props {
  /** upload the layer's pixels → update_layer_content (debounced on stroke end) */
  commitPixels: (layerId: string) => void;
  /** upload the layer's mask pixels → update_layer_mask */
  commitMaskPixels: (layerId: string) => void;
  /** persist a metadata patch → update_layer (position/props) */
  commitMeta: (layerId: string, patch: Partial<Layer>) => void;
  /** persist a transform patch → update_transform (rotate/scale/skew/flip/warp) */
  commitTransform: (layerId: string, patch: Partial<Layer>) => void;
  /** create a new document-sized raster layer from a baked canvas (shapes/gradient) */
  onCreateRasterLayer: (opts: { name: string; x: number; y: number; canvas: HTMLCanvasElement }) => void;
  /** create a new text layer at a document point; resolves to its id */
  onCreateTextLayer: (x: number, y: number) => Promise<string | undefined>;
  /** persist edited text content + fitted size */
  onCommitText: (id: string, text: TextProps, width: number, height: number) => void;
  /** delete a layer (used to discard an empty, just-created text layer) */
  onDeleteLayer: (id: string) => void;
  /** apply a document crop rect */
  onCrop: (rect: { x: number; y: number; w: number; h: number }) => void;
  /** broadcast cursor position (document space) */
  onCursorMove?: (docX: number, docY: number) => void;
  /** overlay (remote cursors) rendered above the canvas */
  overlay?: React.ReactNode;
}

type Mode =
  | "paint" | "move" | "scale" | "rotate" | "skew" | "warp" | "pan"
  | "marquee" | "lasso" | "crop" | "shape" | "gradient" | "clone" | "none";

interface DragState {
  mode: Mode;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  origin?: Layer;
  originMulti?: Layer[]; // snapshots of every layer a move drags (folder contents included)
  handle?: HandleName;
  /** the warp this drag started from, so pin drags are absolute not cumulative */
  originWarp?: WarpCorners;
  /** the grabbed point in the layer's local pixel space (warp/skew maths) */
  startLocal?: { x: number; y: number };
  points?: number[]; // lasso, doc space
  cloneOffset?: { x: number; y: number }; // doc-space source - start
  cloneSnap?: HTMLCanvasElement;
}

export default function CanvasStage({
  commitPixels, commitMaskPixels, commitMeta, commitTransform,
  onCreateRasterLayer, onCreateTextLayer, onCommitText, onDeleteLayer, onCrop,
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
  // Right-click context menu (cut/copy/paste) anchored at screen coords.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const {
    doc, layers, zoom, panX, panY, renderTick,
    activeTool, transformMode, selectedLayerId, selectedLayerIds, editingMaskOf, editingTextId,
    primaryColor, secondaryColor, brushSize, brushHardness, brushOpacity, brushType,
    selection, shapeKind, shapeStroke, gradientType, gradientFill, cloneSource, clipboard,
    view, guides,
    setPan, setZoom, setPrimaryColor, bumpRender, canEdit, pushHistory,
    setSelection, setCloneSource, setClipboard, setEditingText, selectLayer,
  } = useEditorStore();

  // ── Flattened-document cache ─────────────────────────────────────────────
  //
  // `draw()` runs for pan and zoom too, and those change nothing about the
  // document — only how it is blitted. Recompositing for a pan was pure waste
  // (and on a 23-layer showcase, visible waste). The composite is reused unless
  // something it actually depends on changed.
  //
  // `renderTick` covers every imperative pixel mutation (that is what bumps it),
  // and the metadata string covers everything else the compositor reads. Zoom and
  // pan are deliberately absent.
  const flatCache = useRef<{ sig: string; canvas: HTMLCanvasElement } | null>(null);
  const flattened = (ls: Layer[], d: DocumentInfo): HTMLCanvasElement => {
    const sig = `${renderTick}|${d.width}x${d.height}|${d.background}|` + ls.map((l) =>
      [
        l.id, l.layerIndex, l.visible ? 1 : 0, l.parentId ?? "", l.opacity, l.blendMode,
        l.x, l.y, l.width, l.height, l.rotation, l.scaleX, l.scaleY,
        l.skewX, l.skewY, l.flipH ? 1 : 0, l.flipV ? 1 : 0, l.warp ?? "", l.fill ?? "",
        l.maskBlobId ?? "",
      ].join(","),
    ).join(";");
    const hit = flatCache.current;
    if (hit && hit.sig === sig) return hit.canvas;
    const canvas = composite(ls, d.width, d.height, { background: d.background });
    flatCache.current = { sig, canvas };
    return canvas;
  };

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
    drawCheckerboard(ctx, doc.width, doc.height, view.checkerSize);

    ctx.drawImage(flattened(layers, doc), 0, 0);

    // optional grid overlay
    if (view.showGrid) drawGrid(ctx, doc.width, doc.height, view.gridSize, zoom);

    // document border
    ctx.imageSmoothingEnabled = true;
    ctx.strokeStyle = "rgba(165,255,17,0.35)";
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(0, 0, doc.width, doc.height);

    // selection bounding box + transform handles
    const sel = layers.find((l) => l.id === selectedLayerId);
    const gizmo = activeTool === "transform" || activeTool === "move";
    const multi = selectedLayerIds.length > 1
      ? layers.filter((l) => selectedLayerIds.includes(l.id))
      : [];
    if (gizmo && sel?.kind === "group") {
      // A folder has no pixels of its own — outline what it contains, so a
      // selected group reads as one object covering its artwork.
      drawGroupSelection(ctx, groupBounds(layers, sel.id), multi, zoom);
    } else if (multi.length > 1 && gizmo) {
      drawMultiSelection(ctx, multi, zoom);
    } else if (sel && gizmo) {
      drawSelection(ctx, sel, zoom, activeTool === "transform", transformMode === "warp");
    }

    // live previews
    drawLivePreview(ctx, live.current, zoom, primaryColor, shapeKind, shapeStroke, gradientType);

    // pixel selection marching ants
    if (selection) drawAnts(ctx, selection, zoom, doc.width, doc.height);

    ctx.restore();
  }, [doc, layers, zoom, panX, panY, selectedLayerId, selectedLayerIds, activeTool, transformMode, renderTick, selection, primaryColor, shapeKind, shapeStroke, gradientType, view]);

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
      if (e.key === "Escape") { setCropRect(null); setCloneSource(null); setCtxMenu(null); live.current = null; draw(); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") spaceDown.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [draw, setCloneSource]);

  // ── Coordinate helpers ────────────────────────────────────────────────────
  const screenToDoc = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
  };

  // Sample the already-rendered on-screen canvas pixel under the cursor (cheap —
  // no recomposite) for the status-bar colour readout.
  const sampleCanvasColor = (e: { clientX: number; clientY: number }): string | null => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return null;
    const { x, y } = screenToDoc(e);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
    try {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const px = Math.round((e.clientX - rect.left) * dpr);
      const py = Math.round((e.clientY - rect.top) * dpr);
      const d = ctx2d(canvas).getImageData(px, py, 1, 1).data;
      return "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    } catch { return null; }
  };

  // ── Brush dab onto the active layer (or its mask) ──────────────────────────
  const paintTarget = useCallback((layer: Layer): { canvas: HTMLCanvasElement; isMask: boolean } => {
    if (editingMaskOf === layer.id) {
      return { canvas: getMaskCanvas(layer.id, layer.width, layer.height), isMask: true };
    }
    return { canvas: getLayerCanvas(layer.id, layer.width, layer.height), isMask: false };
  }, [editingMaskOf]);

  // A fill layer is procedural until you paint on it. The first paint/erase/
  // selection-bucket bakes its solid colour into a real pixel buffer so brush
  // strokes are visible (the compositor then prefers that buffer). No-op once
  // the layer already has pixels or isn't a fill layer.
  const bakeFillIfNeeded = useCallback((layer: Layer) => {
    if (layer.kind !== "fill" || peekLayerCanvas(layer.id)) return;
    const c = getLayerCanvas(layer.id, layer.width, layer.height);
    const cx = ctx2d(c);
    cx.fillStyle = layer.fill || "#000000";
    cx.fillRect(0, 0, c.width, c.height);
  }, []);

  /** Clip a layer context to the active selection (in the layer's local space). */
  const clipToSelection = (ctx: CanvasRenderingContext2D, layer: Layer) => {
    if (selection) ctx.clip(selectionPathLocal(selection, layer, docBounds()), "evenodd");
  };

  const docBounds = () => (doc ? { width: doc.width, height: doc.height } : undefined);

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
    // Crop mutates the document, so (unlike marquee/lasso) it needs edit rights.
    if (activeTool === "crop") {
      if (!canEdit()) return;
      drag.current.mode = "crop";
      live.current = { mode: "crop", x0: x, y0: y, x1: x, y1: y };
      setCropRect(null);
      return;
    }

    if (!canEdit()) return;

    // text: edit an existing text layer under the cursor, else create one
    if (activeTool === "text") {
      const hit = [...layers].sort((a, b) => b.layerIndex - a.layerIndex)
        .find((l) => {
          if (l.kind !== "text") return false;
          // map the click into the layer's local space so rotation/scale are honoured
          const p = docToLayerLocal(l, x, y);
          return p.x >= 0 && p.x <= l.width && p.y >= 0 && p.y <= l.height;
        });
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
      // The snapshot lives in the SOURCE layer's local pixel space, so the source
      // point must be mapped with the source layer's transform — not the active
      // layer's, which may differ if the user switched layers after sampling.
      const srcLayer = layers.find((l) => l.id === cloneSource.layerId) ?? sel;
      const srcLocal = docToLayerLocal(srcLayer, cloneSource.x, cloneSource.y);
      const startLocal = docToLayerLocal(sel, x, y);
      pushHistory([sel.id], "Clone Stamp");
      dirtyLayer.current = sel.id;
      drag.current.mode = "clone";
      drag.current.cloneSnap = copy;
      drag.current.cloneOffset = { x: startLocal.x - srcLocal.x, y: startLocal.y - srcLocal.y };
      cloneStamp(sel, startLocal.x, startLocal.y);
      bumpRender();
      return;
    }

    if ((activeTool === "brush" || activeTool === "eraser") && sel) {
      if (editingMaskOf !== sel.id) bakeFillIfNeeded(sel); // paint shows on fill layers
      pushHistory([sel.id], activeTool === "eraser" ? "Erase" : "Brush");
      dirtyLayer.current = sel.id;
      drag.current.mode = "paint";
      const loc = docToLayerLocal(sel, x, y);
      strokeLine(sel, loc.x, loc.y, loc.x, loc.y, activeTool === "eraser", editingMaskOf === sel.id);
      bumpRender();
      return;
    }

    if (activeTool === "bucket" && sel) {
      const editingMask = editingMaskOf === sel.id;
      // With NO active selection, fill/text layers are procedural — the bucket
      // just changes their COLOUR via metadata (whole layer). With a selection,
      // we fall through to the pixel path so only the selected region is filled
      // (a fill layer is baked into pixels first so the rest stays intact).
      if (!editingMask && !selection && sel.kind === "fill") {
        pushHistory([], "Fill Color");
        useEditorStore.getState().upsertLayer({ ...sel, fill: primaryColor, updatedAt: Date.now() });
        bumpRender();
        commitMeta(sel.id, { fill: primaryColor });
        drag.current.mode = "none";
        return;
      }
      if (!editingMask && !selection && sel.kind === "text" && sel.text) {
        pushHistory([], "Text Color");
        const text = { ...sel.text, color: primaryColor };
        useEditorStore.getState().upsertLayer({ ...sel, text, updatedAt: Date.now() });
        bumpRender();
        onCommitText(sel.id, text, sel.width, sel.height);
        drag.current.mode = "none";
        return;
      }
      if (!editingMask) bakeFillIfNeeded(sel); // selection-bucket onto a fill layer
      pushHistory([sel.id], "Paint Bucket");
      const { canvas, isMask } = paintTarget(sel);
      const cx = ctx2d(canvas);
      // Fill clipped to the active selection (marquee/lasso shape) when one
      // exists, otherwise the entire layer.
      cx.save();
      clipToSelection(cx, sel);
      cx.globalCompositeOperation = "source-over";
      cx.fillStyle = isMask ? "#ffffff" : primaryColor;
      cx.fillRect(0, 0, canvas.width, canvas.height);
      cx.restore();
      dirtyLayer.current = sel.id;
      drag.current.mode = "none";
      bumpRender();
      finishStroke(sel.id);
      return;
    }

    if ((activeTool === "move" || activeTool === "transform") && sel) {
      const warpMode = transformMode === "warp";
      // A folder has no gizmo handles of its own — grabbing it always moves the
      // subtree, which is the whole point of grouping.
      const handle = activeTool === "transform" && sel.kind !== "group"
        ? hitHandle(sel, x, y, zoom, warpMode)
        : null;
      drag.current.origin = { ...sel };
      drag.current.handle = handle ?? undefined;
      // Every layer this drag should translate: the selection with folder
      // contents expanded, locked layers dropped.
      const movable = movableLayers(layers, selectedLayerIds.length > 0 ? selectedLayerIds : [sel.id]);
      if (!handle && movable.length > 1) {
        drag.current.originMulti = movable.map((l) => ({ ...l }));
      }
      if (handle?.startsWith("warp-")) {
        drag.current.mode = "warp";
        drag.current.originWarp = warpOf(sel);
        drag.current.startLocal = docToLayerLocal(sel, x, y);
      } else if (handle?.startsWith("skew-")) {
        drag.current.mode = "skew";
      } else {
        drag.current.mode = handle === "rot" ? "rotate" : handle ? "scale" : "move";
      }
      const label = drag.current.mode === "move"
        ? (movable.length > 1 ? (sel.kind === "group" ? "Move Group" : "Move Layers") : "Move")
        : drag.current.mode === "warp" ? "Warp"
        : drag.current.mode === "skew" ? "Skew"
        : drag.current.mode === "rotate" ? "Rotate" : "Scale";
      pushHistory([], label);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!doc) return;
    const { x, y } = screenToDoc(e);
    onCursorMove?.(x, y);
    usePointerStore.getState().set(x, y, sampleCanvasColor(e)); // feed rulers + status bar
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

    if (st.mode === "move") {
      const dx = x - st.startX;
      const dy = y - st.startY;
      // Multiple layers: translate them all by the raw delta (no per-layer snap
      // so the group keeps its relative layout).
      if (st.originMulti) {
        const store = useEditorStore.getState();
        for (const o of st.originMulti) {
          const cur = store.layers.find((l) => l.id === o.id);
          if (cur) store.upsertLayer({ ...cur, x: Math.round(o.x + dx), y: Math.round(o.y + dy) });
        }
        bumpRender();
        return;
      }
      if (!st.origin) return;
      let nx = Math.round(st.origin.x + dx);
      let ny = Math.round(st.origin.y + dy);
      if (view.snap && doc && !e.altKey) {
        const lw = sel.width * (sel.scaleX || 100) / 100;
        const lh = sel.height * (sel.scaleY || 100) / 100;
        const tol = 6 / zoom;
        const vCand = snapCandidates("v", doc, view, guides);
        const hCand = snapCandidates("h", doc, view, guides);
        // candidates include doc-centre (width/2) which can be fractional → round
        nx = Math.round(nx + bestSnapDelta([nx, nx + lw / 2, nx + lw], vCand, tol));
        ny = Math.round(ny + bestSnapDelta([ny, ny + lh / 2, ny + lh], hCand, tol));
      }
      useEditorStore.getState().upsertLayer({ ...sel, x: nx, y: ny });
      bumpRender();
      return;
    }

    if (st.mode === "scale" && st.origin) {
      const ox = st.origin;
      // Work in the layer's own axes: a rotated layer must widen along ITS
      // width, not along the screen's x. The handle decides the sign, so the
      // grabbed corner follows the cursor instead of running away from it.
      const d = rotateVec(x - st.startX, y - st.startY, -(ox.rotation || 0));
      const { x: signX, y: signY } = scaleSigns(st.handle ?? "br");
      const sX = Math.max(5, Math.round((ox.scaleX || 100) * (1 + (signX * d.x) / Math.max(40, ox.width))));
      const sY = Math.max(5, Math.round((ox.scaleY || 100) * (1 + (signY * d.y) / Math.max(40, ox.height))));
      // Shift keeps the aspect ratio, as everywhere else.
      const uniform = e.shiftKey;
      const next = uniform
        ? { scaleX: sX, scaleY: Math.max(5, Math.round((ox.scaleY || 100) * (sX / (ox.scaleX || 100)))) }
        : { scaleX: sX, scaleY: sY };
      // Dragging a top/left handle grows the layer towards the cursor, so the
      // opposite edge must stay put: shift the origin by the size change.
      const before = boxSize(ox);
      const after = boxSize({ ...ox, ...next });
      const shift = rotateVec(
        signX < 0 ? before.w - after.w : 0,
        signY < 0 ? before.h - after.h : 0,
        ox.rotation || 0,
      );
      useEditorStore.getState().upsertLayer({
        ...sel, ...next,
        x: Math.round(ox.x + shift.x),
        y: Math.round(ox.y + shift.y),
      });
      bumpRender();
      return;
    }

    if (st.mode === "rotate" && st.origin) {
      const { cx, cy } = centerOf(st.origin);
      let ang = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
      if (e.shiftKey) ang = Math.round(ang / 15) * 15; // Shift snaps to 15°
      useEditorStore.getState().upsertLayer({ ...sel, rotation: Math.round(ang) });
      bumpRender();
      return;
    }

    if (st.mode === "skew" && st.origin) {
      const ox = st.origin;
      const d = rotateVec(x - st.startX, y - st.startY, -(ox.rotation || 0));
      const { sx, sy } = scaleOf(ox);
      const halfW = Math.max(1, (ox.width * Math.abs(sx)) / 2);
      const halfH = Math.max(1, (ox.height * Math.abs(sy)) / 2);
      const clampDeg = (v: number) => Math.max(-80, Math.min(80, Math.round(v)));
      const deg = (t: number) => (Math.atan(t) * 180) / Math.PI;
      if (st.handle === "skew-top" || st.handle === "skew-bottom") {
        // Horizontal shear: how far the grabbed edge slid sideways, over its
        // distance from the centre. Grabbing the bottom edge shears the other way.
        const dir = st.handle === "skew-top" ? -1 : 1;
        const t = Math.tan((clampDeg(ox.skewX) * Math.PI) / 180) + (dir * d.x) / halfH;
        useEditorStore.getState().upsertLayer({ ...sel, skewX: clampDeg(deg(t)) });
      } else {
        const dir = st.handle === "skew-left" ? -1 : 1;
        const t = Math.tan((clampDeg(ox.skewY) * Math.PI) / 180) + (dir * d.y) / halfW;
        useEditorStore.getState().upsertLayer({ ...sel, skewY: clampDeg(deg(t)) });
      }
      bumpRender();
      return;
    }

    if (st.mode === "warp" && st.origin && st.originWarp && st.startLocal) {
      // Pin drags are computed in the layer's LOCAL space (the space warp offsets
      // live in), so the pin tracks the cursor even on a rotated or scaled layer.
      const local = docToLayerLocal(st.origin, x, y);
      const dx = local.x - st.startLocal.x;
      const dy = local.y - st.startLocal.y;
      const corner = (st.handle ?? "").slice(5) as keyof WarpCorners;
      const base = st.originWarp[corner] ?? [0, 0];
      const next: WarpCorners = {
        tl: [...st.originWarp.tl] as [number, number],
        tr: [...st.originWarp.tr] as [number, number],
        br: [...st.originWarp.br] as [number, number],
        bl: [...st.originWarp.bl] as [number, number],
      };
      next[corner] = [Math.round(base[0] + dx), Math.round(base[1] + dy)];
      useEditorStore.getState().upsertLayer({ ...sel, warp: serializeWarp(next) });
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
    } else if (st.mode === "move" && st.originMulti) {
      // One update_layer per moved layer — the folder itself included, so its own
      // x/y keeps tracking its contents.
      const cur = useEditorStore.getState().layers;
      for (const o of st.originMulti) {
        const l = cur.find((x) => x.id === o.id);
        if (l && (l.x !== o.x || l.y !== o.y)) commitMeta(l.id, { x: l.x, y: l.y });
      }
    } else if (st.mode === "move" && sel) {
      commitMeta(sel.id, { x: sel.x, y: sel.y });
    } else if (st.mode === "scale" && sel) {
      // Scaling from a top/left handle also moves the origin.
      commitMeta(sel.id, { x: sel.x, y: sel.y });
      commitTransform(sel.id, { scaleX: sel.scaleX, scaleY: sel.scaleY });
    } else if (st.mode === "rotate" && sel) {
      commitTransform(sel.id, { rotation: sel.rotation });
    } else if (st.mode === "skew" && sel) {
      commitTransform(sel.id, { skewX: sel.skewX, skewY: sel.skewY });
    } else if (st.mode === "warp" && sel) {
      commitTransform(sel.id, { warp: sel.warp ?? "" });
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

  // Double-click a text layer (with any tool) to re-edit its content.
  const onDoubleClick = (e: React.MouseEvent) => {
    if (!doc) return;
    const { x, y } = screenToDoc(e);
    const hit = [...layers].sort((a, b) => b.layerIndex - a.layerIndex).find((l) => {
      if (l.kind !== "text") return false;
      const p = docToLayerLocal(l, x, y);
      return p.x >= 0 && p.x <= l.width && p.y >= 0 && p.y <= l.height;
    });
    if (hit) { selectLayer(hit.id); setEditingText(hit.id); }
  };

  // ── Clipboard: cut / copy / paste on the active selection ───────────────────
  // Copy grabs the composited pixels inside the selection (masked to its shape)
  // into a bbox-sized canvas; paste drops them back as a brand-new raster layer.
  const doCopy = useCallback((): boolean => {
    if (!doc || !selection) return false;
    const active = layers.find((l) => l.id === selectedLayerId);
    if (!active) return false;
    const b = selectionBounds(selection, doc.width, doc.height);
    if (b.w < 1 || b.h < 1) return false;
    // Confine the copy to the ACTIVE layer only (not the flattened composite),
    // so a selection never pulls pixels from other layers.
    const flat = composite([active], doc.width, doc.height, {});
    const out = createCanvas(b.w, b.h);
    const octx = ctx2d(out);
    octx.save();
    octx.translate(-b.x, -b.y);
    octx.clip(selectionPathDoc(selection, { width: doc.width, height: doc.height }), "evenodd");
    octx.drawImage(flat, 0, 0);
    octx.restore();
    setClipboard({ canvas: out, x: b.x, y: b.y });
    return true;
  }, [doc, selection, layers, selectedLayerId, setClipboard]);

  const doCut = useCallback(() => {
    if (!canEdit() || !doCopy()) return;
    const sel = layers.find((l) => l.id === selectedLayerId);
    // Only raster layers have pixels to erase; clear the selected region.
    if (sel && sel.kind === "raster" && selection) {
      pushHistory([sel.id], "Cut");
      const c = getLayerCanvas(sel.id, sel.width, sel.height);
      const cx = ctx2d(c);
      cx.save();
      cx.globalCompositeOperation = "destination-out";
      cx.fillStyle = "#000";
      cx.fill(selectionPathLocal(selection, sel, doc ? { width: doc.width, height: doc.height } : undefined), "evenodd");
      cx.restore();
      bumpRender();
      commitPixels(sel.id);
    }
  }, [canEdit, doCopy, layers, selectedLayerId, selection, pushHistory, bumpRender, commitPixels, doc]);

  const doPaste = useCallback(() => {
    if (!canEdit() || !clipboard) return;
    onCreateRasterLayer({ name: "Pasted", x: clipboard.x, y: clipboard.y, canvas: clipboard.canvas });
  }, [canEdit, clipboard, onCreateRasterLayer]);

  // Ctrl/Cmd + C / X / V shortcuts (mirror the right-click menu).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "c" && selection) { e.preventDefault(); doCopy(); }
      else if (k === "x" && selection) { e.preventDefault(); doCut(); }
      else if (k === "v" && clipboard) { e.preventDefault(); doPaste(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, clipboard, doCopy, doCut, doPaste]);

  const onContextMenu = (e: React.MouseEvent) => {
    // Only hijack the browser menu when there's something to act on.
    if (!selection && !clipboard) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

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
        data-testid="main-canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => usePointerStore.getState().set(null, null)}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
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
          onCancel={() => {
            const id = editingText.id;
            const c = editingText.text?.content ?? "";
            setEditingText(null);
            // discard a freshly created text layer that never got real content
            if (!c || c === "Double-click to edit") onDeleteLayer(id);
          }}
        />
      )}

      {activeTool === "transform" && transformMode === "warp" && (
        <div className={styles.hint} data-testid="warp-hint">
          Warp — drag the four corner pins. Switch back to Free to scale or rotate.
        </div>
      )}

      {cloneSource && activeTool === "clone" && (
        <div className={styles.hint}>Clone source set — paint to stamp. Alt/⌘-click to re-sample.</div>
      )}
      {activeTool === "clone" && !cloneSource && (
        <div className={styles.hint}>Alt/⌘-click to set the clone source, then paint.</div>
      )}

      {ctxMenu && (
        <>
          <div
            className={styles.ctxBackdrop}
            onPointerDown={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
          />
          <div className={styles.ctxMenu} style={{ left: ctxMenu.x, top: ctxMenu.y }} role="menu">
            <button type="button" disabled={!selection || !canEdit()} onClick={() => { doCut(); setCtxMenu(null); }}>Cut</button>
            <button type="button" disabled={!selection} onClick={() => { doCopy(); setCtxMenu(null); }}>Copy</button>
            <button type="button" disabled={!clipboard || !canEdit()} onClick={() => { doPaste(); setCtxMenu(null); }}>Paste</button>
          </div>
        </>
      )}

      <GuidesOverlay />
      {view.showCrosshair && <Crosshair />}

      {overlay}
    </div>
  );
}

// ── Guides overlay (draggable when Move/Hand is active) ──────────────────────
function GuidesOverlay() {
  const guides = useEditorStore((s) => s.guides);
  const showGuides = useEditorStore((s) => s.view.showGuides);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const activeTool = useEditorStore((s) => s.activeTool);
  const moveGuide = useEditorStore((s) => s.moveGuide);
  const removeGuide = useEditorStore((s) => s.removeGuide);
  if (!showGuides || guides.length === 0) return null;
  const grabbable = activeTool === "move" || activeTool === "hand";

  const onDrag = (id: string, orient: "h" | "v") => (e: React.PointerEvent) => {
    if (!grabbable) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const cv = document.querySelector('[data-testid="main-canvas"]') as HTMLElement | null;
    const rect = cv?.getBoundingClientRect();
    const compute = (ev: PointerEvent | React.PointerEvent) =>
      orient === "h"
        ? ((ev.clientY - (rect?.top ?? 0)) - panY) / zoom
        : ((ev.clientX - (rect?.left ?? 0)) - panX) / zoom;
    const move = (ev: PointerEvent) => moveGuide(id, compute(ev));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (compute(ev) < 0) removeGuide(id); // dragged back past the ruler → delete
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <>
      {guides.map((g) => {
        const horizontal = g.orient === "h";
        const style: React.CSSProperties = horizontal
          ? { top: g.pos * zoom + panY, left: 0, right: 0, height: 1 }
          : { left: g.pos * zoom + panX, top: 0, bottom: 0, width: 1 };
        return (
          <div
            key={g.id}
            className={`${styles.guide} ${horizontal ? styles.guideH : styles.guideV} ${grabbable ? styles.guideGrab : ""}`}
            style={style}
            onPointerDown={onDrag(g.id, g.orient)}
            onDoubleClick={(e) => { e.stopPropagation(); removeGuide(g.id); }}
            title={grabbable ? "Drag to move · double-click to remove" : undefined}
          />
        );
      })}
    </>
  );
}

// ── Cursor crosshair across the whole canvas (Photoshop precise cursor) ──────
function Crosshair() {
  const x = usePointerStore((s) => s.x);
  const y = usePointerStore((s) => s.y);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  if (x == null || y == null) return null;
  const sx = x * zoom + panX;
  const sy = y * zoom + panY;
  return (
    <>
      <div className={`${styles.cross} ${styles.crossV}`} style={{ left: sx }} />
      <div className={`${styles.cross} ${styles.crossH}`} style={{ top: sy }} />
    </>
  );
}

// Tight integer bounding box of a selection in document space, clamped to canvas.
function selectionBounds(sel: Selection, docW: number, docH: number) {
  // Inverted selections cover everything outside the shape → use the full doc.
  if (sel.inverted) return { x: 0, y: 0, w: docW, h: docH };
  let x0: number, y0: number, x1: number, y1: number;
  if (sel.kind === "rect") {
    x0 = sel.x; y0 = sel.y; x1 = sel.x + sel.w; y1 = sel.y + sel.h;
  } else {
    const pts = sel.points;
    x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
      y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
    }
  }
  const X0 = Math.max(0, Math.floor(Math.min(x0, x1)));
  const Y0 = Math.max(0, Math.floor(Math.min(y0, y1)));
  const X1 = Math.min(docW, Math.ceil(Math.max(x0, x1)));
  const Y1 = Math.min(docH, Math.ceil(Math.max(y0, y1)));
  return { x: X0, y: Y0, w: Math.max(0, X1 - X0), h: Math.max(0, Y1 - Y0) };
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
  // Guard so the textarea's onBlur (fired when we unmount on Escape) can't
  // re-commit a cancelled edit.
  const done = useRef(false);

  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const content = value.trim();
    // Empty text isn't a real layer — discard it (deletes a freshly created one)
    // rather than persisting the placeholder "Text".
    if (!content) { onCancel(); return; }
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
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
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

function drawCheckerboard(ctx: CanvasRenderingContext2D, w: number, h: number, size = 8) {
  const s = Math.max(2, size);
  ctx.save();
  ctx.fillStyle = "#15191f";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#1d232b";
  for (let y = 0; y < h; y += s) {
    for (let x = 0; x < w; x += s) {
      if (((Math.floor(x / s)) + (Math.floor(y / s))) % 2 === 0) ctx.fillRect(x, y, s, s);
    }
  }
  ctx.restore();
}

// Document-aligned grid. Every 5th line is brighter (major) like Photoshop.
function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, size: number, zoom: number) {
  const step = Math.max(2, size);
  ctx.save();
  ctx.lineWidth = 1 / zoom;
  let n = 0;
  for (let x = 0; x <= w; x += step, n++) {
    ctx.strokeStyle = n % 5 === 0 ? "rgba(165,255,17,0.22)" : "rgba(255,255,255,0.10)";
    ctx.beginPath();
    ctx.moveTo(x + 0.5 / zoom, 0);
    ctx.lineTo(x + 0.5 / zoom, h);
    ctx.stroke();
  }
  n = 0;
  for (let y = 0; y <= h; y += step, n++) {
    ctx.strokeStyle = n % 5 === 0 ? "rgba(165,255,17,0.22)" : "rgba(255,255,255,0.10)";
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5 / zoom);
    ctx.lineTo(w, y + 0.5 / zoom);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAnts(ctx: CanvasRenderingContext2D, sel: Selection, zoom: number, docW?: number, docH?: number) {
  const path = selectionPathDoc(sel, docW != null && docH != null ? { width: docW, height: docH } : undefined);
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

function tracePath(ctx: CanvasRenderingContext2D, pts: Array<{ x: number; y: number }>) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function square(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, size: number) {
  ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
}

function dot(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, r: number) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawSelection(
  ctx: CanvasRenderingContext2D, l: Layer, zoom: number, handles: boolean, warpMode = false,
) {
  const p = handlePoints(l);
  ctx.save();
  ctx.strokeStyle = "#A5FF11";
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([4 / zoom, 3 / zoom]);
  tracePath(ctx, [p.tl, p.tr, p.br, p.bl]);
  ctx.stroke();
  ctx.setLineDash([]);

  if (handles && warpMode) {
    // Warp: only the four corner pins, drawn as rings so they read differently
    // from the solid scale handles.
    const r = 6 / zoom;
    ctx.lineWidth = 2 / zoom;
    for (const c of [p.tl, p.tr, p.br, p.bl]) {
      ctx.fillStyle = "rgba(15,20,25,0.85)";
      dot(ctx, c, r);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (handles) {
    const hs = 7 / zoom;
    ctx.fillStyle = "#A5FF11";
    for (const c of [p.tl, p.tr, p.bl, p.br]) square(ctx, c, hs);
    // edge midpoints = shear grips
    ctx.fillStyle = "rgba(165,255,17,0.75)";
    for (const c of [p.top, p.bottom, p.left, p.right]) square(ctx, c, hs * 0.8);
    // rotation knob on a stalk
    ctx.strokeStyle = "#A5FF11";
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.moveTo(p.top.x, p.top.y);
    ctx.lineTo(p.rot.x, p.rot.y);
    ctx.stroke();
    ctx.fillStyle = "#A5FF11";
    dot(ctx, p.rot, hs * 0.7);
  }
  ctx.restore();
}

/** Outline of a selected folder: one solid box around everything it contains,
 *  plus a faint outline per member so it is clear what travels with it. */
function drawGroupSelection(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  members: Layer[],
  zoom: number,
) {
  ctx.save();
  ctx.strokeStyle = "rgba(165,255,17,0.4)";
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([3 / zoom, 3 / zoom]);
  for (const l of members) {
    if (l.kind === "group") continue;
    tracePath(ctx, cornersOf(l));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (bounds.w > 0 && bounds.h > 0) {
    ctx.strokeStyle = "#A5FF11";
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
    // corner ticks, so a folder box is distinguishable from a layer box
    const t = 8 / zoom;
    ctx.lineWidth = 2.5 / zoom;
    const corners: Array<[number, number, number, number]> = [
      [bounds.x, bounds.y, 1, 1],
      [bounds.x + bounds.w, bounds.y, -1, 1],
      [bounds.x, bounds.y + bounds.h, 1, -1],
      [bounds.x + bounds.w, bounds.y + bounds.h, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + sx * t, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * t);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Combined bounding box around several selected layers (axis-aligned union of
// their transformed quads). Drawn when 2+ layers are selected under Move/Transform.
function drawMultiSelection(ctx: CanvasRenderingContext2D, layers: Layer[], zoom: number) {
  for (const l of layers) {
    // per-layer faint outline so it's clear which layers are in the set
    ctx.save();
    ctx.strokeStyle = "rgba(165,255,17,0.45)";
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([3 / zoom, 3 / zoom]);
    tracePath(ctx, cornersOf(l));
    ctx.stroke();
    ctx.restore();
  }
  const b = unionBounds(layers);
  if (b.w <= 0 && b.h <= 0) return;
  ctx.save();
  ctx.strokeStyle = "#A5FF11";
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.restore();
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
  if (selection) ctx.clip(selectionPathDoc(selection, { width: docW, height: docH }), "evenodd");
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
  if (selection) ctx.clip(selectionPathDoc(selection, { width: docW, height: docH }), "evenodd");
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
