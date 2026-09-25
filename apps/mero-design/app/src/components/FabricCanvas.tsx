import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ActiveSelection,
  Canvas,
  Point,
  Rect,
  Circle,
  Line,
  IText,
  FabricImage,
  Path,
  Pattern,
  PencilBrush,
  Polygon,
  Shadow,
  Group,
  Text as FabricText,
  type FabricObject,
} from "fabric";
import { v4 as uuid } from "uuid";
import { rpcCall } from "../api/rpc";
import { applyTopLeftOrigin } from "../utils/fabricDefaults";
import { isPaintable } from "../utils/color";
import { createMutationReporter } from "../utils/mutationErrors";
import { useToast } from "../contexts/ToastContext";
import { countRender } from "../utils/renderCount";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore, type Tool } from "../store/canvasStore";
import { wheelAction } from "../utils/wheel";
import {
  detachMoved,
  isConnector,
  nearestAnchor,
  parseBinding,
  reroute,
  routedEndpoints,
  shapeUnder,
  anchorsOf,
  connectorGeometry,
  formatBinding,
  type Anchor,
} from "../utils/connectors";
import { saveDataUrl, saveText } from "../utils/saveFile";
import type { Element } from "../types";
import {
  dashArray,
  isShapeKind,
  ROUNDED_CORNER_RADIUS,
  shapeDefaults,
  shapePath,
  strokeCap,
} from "../utils/shapes";
import {
  fontOf,
  inkOf,
  isBoxText,
  layoutBox,
  measurerFor,
  newSticky,
  rectToBox,
} from "../utils/boxText";
import TextBoxEditor from "./TextBoxEditor";
import styles from "./FabricCanvas.module.css";

// Must run before any Fabric object is constructed — see fabricDefaults.ts.
applyTopLeftOrigin();

/**
 * Dev-only counters for the perf bench (`e2e/perf/`). Wall-clock alone cannot
 * tell "the canvas was rebuilt once" from "it was rebuilt fifty times and each
 * one was fast enough to hide"; these can. Dropped from production builds.
 */
function countBuild(objects: number): void {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as { __canvasBuilds?: { syncs: number; objects: number } };
  const c = (w.__canvasBuilds ??= { syncs: 0, objects: 0 });
  c.syncs += 1;
  c.objects += objects;
}

/**
 * A Fabric object the canvas sync owns. `data` is the element it was built from
 * — identity, not a copy, which is what makes the reconcile cheap. `srcKey` is
 * the image bytes it was decoded from, so a blob arriving later can be told
 * apart from the same element re-rendered for another reason.
 */
type CanvasObject = FabricObject & { data?: Element; srcKey?: string };

/**
 * Put the canvas back in layer order. Fabric paints in insertion order, so
 * anything added or replaced lands on top no matter what its layerIndex says.
 * A no-op when the order is already right, which is the common case.
 */
function restack(fc: Canvas): void {
  const objects = fc.getObjects() as CanvasObject[];
  // Transient objects (drag preview, brush stroke) have no element and belong
  // on top; sorting them to the end keeps them visible.
  const layerOf = (o: CanvasObject) => (o.data ? o.data.layerIndex : Number.MAX_SAFE_INTEGER);
  const target = [...objects].sort((a, b) => layerOf(a) - layerOf(b));
  if (target.every((o, i) => o === objects[i])) return;
  target.forEach((o, i) => fc.moveObjectTo(o, i));
}

export interface FabricCanvasHandle {
  exportPng: () => Promise<void>;
  exportSvg: () => Promise<void>;
  exportSelectedPng: () => Promise<void>;
  exportSelectedSvg: () => Promise<void>;
}

interface Props {
  contextId: string;
  previewMode?: boolean;
  /** True while the user is placing a comment — Escape cancels that instead of deleting. */
  addingComment?: boolean;
  /** True for viewers (no editor/admin role). Blocks all canvas mutations — the
   *  contract also rejects them at merge, this just avoids ghost local edits. */
  readOnly?: boolean;
  onViewportChange?: (zoom: number, panX: number, panY: number) => void;
}

function makeDotPattern(bgColor: string): HTMLCanvasElement {
  const dotColor =
    bgColor === "#111111" ? "#252525" :
    bgColor === "#808080" ? "#686868" :
    "#d8d8d8";
  const size = 20;
  const el = document.createElement("canvas");
  el.width = size;
  el.height = size;
  const ctx = el.getContext("2d")!;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 1, 0, Math.PI * 2);
  ctx.fill();
  return el;
}

const FabricCanvas = forwardRef<FabricCanvasHandle, Props>(
  ({ contextId, previewMode = false, addingComment = false, readOnly = false, onViewportChange }, ref) => {
    countRender("FabricCanvas");
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<Canvas | null>(null);
    const previewRef = useRef(previewMode);
    const addingCommentRef = useRef(addingComment);
    const readOnlyRef = useRef(readOnly);
    const backgroundRef = useRef<string>("#ffffff");
    const spaceHeldRef = useRef(false);
    const onViewportChangeRef = useRef(onViewportChange);
    const previewObjRef = useRef<FabricObject | null>(null);
    const handPanningRef = useRef(false);
    const handPanLastRef = useRef({ x: 0, y: 0 });
    /** Per-element load counter, so a superseded image decode drops its result. */
    const imageTokensRef = useRef(new Map<string, number>());
    const [zoom, setZoom] = useState(1);
    const { showToast } = useToast();
    // See utils/mutationErrors: these used to be `.catch(() => {})`, so a failed
    // save left the canvas looking correct until the next sync silently undid it.
    const reportFailure = useRef(createMutationReporter((m) => showToast(m, "error")));
    reportFailure.current = createMutationReporter((m) => showToast(m, "error"));

    // Bare `useCanvasStore()` subscribes to the whole store, so renaming a layer
    // or collapsing a group in the panel re-rendered the canvas for nothing.
    const {
      activeTool,
      selectedElementId,
      selectedElementIds,
      elements,
      background,
      imageCache,
      selectElement,
      selectElements,
      selectWithPointer,
      upsertElement,
      removeElement,
      cacheImage,
      snapshot,
      undo,
      redo,
      copyElements,
      getPasted,
      editingTextId,
      startTextEdit,
      stopTextEdit,
    } = useCanvasStore(
      useShallow((s) => ({
        activeTool: s.activeTool,
        selectedElementId: s.selectedElementId,
        selectedElementIds: s.selectedElementIds,
        elements: s.elements,
        background: s.background,
        imageCache: s.imageCache,
        selectElement: s.selectElement,
        selectElements: s.selectElements,
        selectWithPointer: s.selectWithPointer,
        upsertElement: s.upsertElement,
        removeElement: s.removeElement,
        cacheImage: s.cacheImage,
        snapshot: s.snapshot,
        undo: s.undo,
        redo: s.redo,
        copyElements: s.copyElements,
        getPasted: s.getPasted,
        editingTextId: s.editingTextId,
        startTextEdit: s.startTextEdit,
        stopTextEdit: s.stopTextEdit,
      })),
    );

    previewRef.current = previewMode;
    addingCommentRef.current = addingComment;
    readOnlyRef.current = readOnly;
    backgroundRef.current = background;
    onViewportChangeRef.current = onViewportChange;

    /* ── export helpers ──────────────────────────────────────────── */
    function withSolidBgData<T>(fn: () => T): T {
      const fc = fabricRef.current!;
      const saved = fc.backgroundColor;
      fc.set("backgroundColor", backgroundRef.current);
      fc.renderAll();
      const result = fn();
      fc.set("backgroundColor", saved);
      fc.renderAll();
      return result;
    }

    /**
     * Every export used to be `await save…()` with no catch, so a rejection —
     * which is exactly what the Tauri path produced — surfaced as an unhandled
     * promise in a console nobody had open, and as nothing at all in the UI.
     */
    async function runExport(what: string, fn: () => Promise<boolean>) {
      try {
        if (await fn()) showToast(`${what} exported`, "success");
      } catch (err) {
        showToast(
          `Could not export the ${what.toLowerCase()}: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    }

    useImperativeHandle(ref, () => ({
      async exportPng() {
        const url = withSolidBgData(() => fabricRef.current!.toDataURL({ format: "png", multiplier: 2 }));
        await runExport("PNG", () => saveDataUrl(url, "mero-design-export.png"));
      },
      async exportSvg() {
        const svg = withSolidBgData(() => fabricRef.current!.toSVG());
        await runExport("SVG", () => saveText(svg, "mero-design-export.svg", "image/svg+xml"));
      },
      async exportSelectedPng() {
        const fc = fabricRef.current;
        if (!fc) return;
        const active = fc.getActiveObject();
        const url = withSolidBgData(() => {
          if (active) {
            const b = active.getBoundingRect();
            return fc.toDataURL({ format: "png", multiplier: 2, left: b.left, top: b.top, width: b.width, height: b.height });
          }
          return fc.toDataURL({ format: "png", multiplier: 2 });
        });
        await runExport("PNG", () => saveDataUrl(url, "mero-design-selection.png"));
      },
      async exportSelectedSvg() {
        const fc = fabricRef.current;
        if (!fc) return;
        const active = fc.getActiveObject();
        if (active) {
          const allObjs = fc.getObjects();
          const selObjs: FabricObject[] = (active as (FabricObject & { getObjects?: () => FabricObject[] })).getObjects?.() ?? [active];
          const hidden: FabricObject[] = [];
          allObjs.forEach((o) => { if (!selObjs.includes(o)) { o.visible = false; hidden.push(o); } });
          fc.renderAll();
          const svg = fc.toSVG();
          hidden.forEach((o) => { o.visible = true; });
          fc.renderAll();
          await runExport("SVG", () => saveText(svg, "mero-design-selection.svg", "image/svg+xml"));
        } else {
          const svg = fc.toSVG();
          await runExport("SVG", () => saveText(svg, "mero-design-export.svg", "image/svg+xml"));
        }
      },
    }));

    /* ── canvas dimensions helper ────────────────────────────────── */
    function getSize() {
      if (previewRef.current) return { w: window.innerWidth, h: window.innerHeight };
      return { w: window.innerWidth - 240, h: window.innerHeight - 48 };
    }

    /* ── init ────────────────────────────────────────────────────── */
    useEffect(() => {
      if (!canvasElRef.current) return;
      const { w, h } = getSize();
      const fc = new Canvas(canvasElRef.current, {
        width: w,
        height: h,
        backgroundColor: "#ffffff",
        selection: true,
      });
      fabricRef.current = fc;
      // item 8: ⌘-click (macOS) and Ctrl-click (Windows/Linux) add to and remove
      // from the selection, like a file manager. Shift keeps working as before.
      fc.selectionKey = ["shiftKey", "metaKey", "ctrlKey"];
      // Hangs the live canvas off its own element. The e2e suite asserts on
      // Fabric's own notion of what is selected (there is no DOM for it), and it
      // is the only way to inspect canvas state from a debugger console.
      (canvasElRef.current as HTMLCanvasElement & { __fabricCanvas?: Canvas }).__fabricCanvas = fc;

      const resize = () => {
        const { w: nw, h: nh } = getSize();
        fc.setDimensions({ width: nw, height: nh });
        fc.renderAll();
      };
      window.addEventListener("resize", resize);

      /* ── wheel: pan, or zoom on pinch / ⌘ ─────────────────────── */
      // Which of those it is, and how far, lives in utils/wheel — see the note
      // there for why this used to zoom on everything and crawl while doing it.
      const MIN_ZOOM = 0.05;
      const MAX_ZOOM = 40;

      fc.on("mouse:wheel", (opt) => {
        const e = opt.e as WheelEvent;
        e.preventDefault();
        e.stopPropagation();

        const action = wheelAction(e, { width: fc.width ?? 1, height: fc.height ?? 1 });
        if (action.kind === "none") return;

        if (action.kind === "zoom") {
          const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fc.getZoom() * action.factor));
          // Anchored at the pointer, so the thing under the fingers stays put.
          fc.zoomToPoint(new Point(e.offsetX, e.offsetY), z);
          setZoom(z);
          const vpt = fc.viewportTransform;
          if (vpt) onViewportChangeRef.current?.(z, vpt[4], vpt[5]);
          return;
        }

        fc.relativePan(new Point(action.dx, action.dy));
        const vpt = fc.viewportTransform;
        if (vpt) onViewportChangeRef.current?.(fc.getZoom(), vpt[4], vpt[5]);
      });

      /* ── pan (space + drag or alt + drag) ───────────────────── */
      let panning = false;
      let panLastX = 0;
      let panLastY = 0;

      const onPanDown = (opt: { e: MouseEvent }) => {
        const e = opt.e;
        if (spaceHeldRef.current || e.altKey || e.button === 1) {
          panning = true;
          panLastX = e.clientX;
          panLastY = e.clientY;
          fc.setCursor("grabbing");
          fc.selection = false;
        }
      };
      const onPanMove = (opt: { e: MouseEvent }) => {
        if (!panning) return;
        const e = opt.e;
        const dx = e.clientX - panLastX;
        const dy = e.clientY - panLastY;
        panLastX = e.clientX;
        panLastY = e.clientY;
        fc.relativePan(new Point(dx, dy));
        const vpt = fc.viewportTransform;
        if (vpt) onViewportChangeRef.current?.(fc.getZoom(), vpt[4], vpt[5]);
      };
      const onPanUp = () => {
        if (panning) {
          panning = false;
          fc.selection = useCanvasStore.getState().activeTool === "select";
          fc.setCursor("default");
        }
      };
      fc.on("mouse:down", onPanDown as (e: unknown) => void);
      fc.on("mouse:move", onPanMove as (e: unknown) => void);
      fc.on("mouse:up", onPanUp);

      return () => {
        window.removeEventListener("resize", resize);
        fc.dispose();
        fabricRef.current = null;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ── trigger resize when preview mode changes ───────────────── */
    useEffect(() => {
      window.dispatchEvent(new Event("resize"));
    }, [previewMode]);

    /* ── dotted background (Fabric Pattern — sits behind elements) */
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc) return;
      const src = makeDotPattern(background);
      const pattern = new Pattern({ source: src, repeat: "repeat" });
      fc.set("backgroundColor", pattern);
      fc.renderAll();
    }, [background]);

    /* ── sync elements store → canvas ───────────────────────────── */
    // This used to be `fc.clear()` followed by a rebuild of every element, on
    // every change to `elements` OR `imageCache`. Two things made that expensive
    // out of proportion to what actually changed:
    //
    //   - one peer nudging one shape rebuilt the whole board. At 300 elements
    //     that is 300 Fabric constructions for a 1px move (49.6ms median frame,
    //     115ms p95 — measured, see e2e/perf/).
    //   - `cacheImage` writes one blob at a time, and each write is its own
    //     store change, so loading a board of N images rebuilt the canvas N
    //     times and re-decoded every already-loaded image each round: N²/2
    //     constructions and N²/2 `FabricImage.fromURL` decodes. 50 images cost
    //     2445ms and built 2500 objects.
    //
    // So reconcile instead. An object is reused when the element it was built
    // from is the very same object (`upsertElement` replaces one entry and keeps
    // the rest by reference) and, for images, when its bytes have not changed.
    // Everything else — add, remove, rebuild, restack — is per-element.
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc) return;
      const activeObj = fc.getActiveObject() as (IText & { isEditing?: boolean }) | null;
      if (activeObj?.isEditing) return;
      // Reconciling would destroy a live multi-selection: an ActiveSelection
      // owns its members, so re-adding one drops it out from under the cursor.
      if (fc.getActiveObject() instanceof ActiveSelection) return;

      const prevSelectedId = useCanvasStore.getState().selectedElementId;

      const sorted = [...elements].sort((a, b) => a.layerIndex - b.layerIndex);
      const wanted = new Map(sorted.map((el) => [el.id, el]));

      // Objects without an element id are transient (the drag preview, a brush
      // path mid-stroke) and are not ours to remove.
      const existing = new Map<string, CanvasObject>();
      for (const o of fc.getObjects() as CanvasObject[]) {
        const id = o.data?.id;
        if (!id) continue;
        if (!wanted.has(id)) { fc.remove(o); continue; }
        existing.set(id, o);
      }

      let built = 0;
      let structureChanged = false;

      for (const el of sorted) {
        const current = existing.get(el.id);
        const cached = imageCache[el.id];
        const isImage = el.data.kind === "image" || el.data.kind === "svg";
        // Reference equality is the whole trick: an element the user did not
        // touch is the same object across a store write, so its Fabric object
        // is still correct and is left completely alone.
        if (current && current.data === el && (!isImage || current.srcKey === cached)) continue;
        if (current) { fc.remove(current); existing.delete(el.id); }
        structureChanged = true;
        built += 1;

        if (isImage) {
          if (cached) {
            // Late arrivals must not stack up: a second blob for the same element
            // invalidates the first load, which may still be decoding.
            const token = (imageTokensRef.current.get(el.id) ?? 0) + 1;
            imageTokensRef.current.set(el.id, token);
            FabricImage.fromURL(cached).then((img) => {
              const sx = el.width / (img.width || el.width);
              const sy = el.height / (img.height || el.height);
              img.set({
                left: el.x, top: el.y,
                scaleX: sx,
                scaleY: sy,
                angle: el.rotation,
                opacity: el.opacity / 100,
                // A border on an image: paint the stroke first so it sits outside
                // the bitmap, and divide by the scale so a strokeWidth of 4 is 4
                // screen pixels rather than 4 * scale.
                stroke: isPaintable(el.stroke) ? el.stroke : undefined,
                strokeWidth: isPaintable(el.stroke) ? el.strokeWidth / Math.max(sx, sy, 0.0001) : 0,
                paintFirst: "stroke",
                data: el,
                selectable: !readOnlyRef.current,
                evented: !readOnlyRef.current,
              });
              // Superseded while decoding, or the canvas went away under us.
              if (fabricRef.current !== fc) return;
              if (imageTokensRef.current.get(el.id) !== token) return;
              (img as CanvasObject).srcKey = cached;
              const stale = (fc.getObjects() as CanvasObject[]).find((o) => o.data?.id === el.id);
              if (stale) fc.remove(stale);
              fc.add(img);
              if (prevSelectedId && el.id === prevSelectedId) fc.setActiveObject(img);
              // An image finishes decoding after the synchronous shapes are
              // already placed, so it would otherwise always land on top
              // regardless of its layer index.
              restack(fc);
              fc.renderAll();
            });
          } else {
            // Placeholder: gray=loading (blobId present, fetch in flight), striped=unavailable
            const hasBlobId = !!(el.data as { blobId?: string }).blobId;
            const bg = new Rect({
              width: el.width, height: el.height,
              // An explicit fill wins over the placeholder tint, so a blob image
              // still shows its own colour while the bytes are in flight.
              fill: isPaintable(el.fill) ? el.fill : hasBlobId ? "#e8e8e8" : "#fce8e8",
              stroke: isPaintable(el.stroke) ? el.stroke : hasBlobId ? "#ccc" : "#e09090",
              strokeWidth: isPaintable(el.stroke) ? el.strokeWidth || 1 : 1,
            });
            const label = new FabricText(hasBlobId ? "Loading…" : "Image unavailable", {
              fontSize: Math.max(10, Math.min(14, el.width / 12)),
              fill: hasBlobId ? "#999" : "#c06060",
              textAlign: "center",
              left: el.width / 2,
              top: el.height / 2,
              originX: "center", originY: "center",
            });
            const group = new Group([bg, label], { left: el.x, top: el.y, selectable: !readOnlyRef.current, evented: !readOnlyRef.current });
            const placeholder = group as CanvasObject;
            placeholder.data = el;
            placeholder.srcKey = undefined;
            fc.add(group);
            if (prevSelectedId && el.id === prevSelectedId) fc.setActiveObject(group);
          }
          continue;
        }
        const obj = buildFabricObject(el);
        if (obj) {
          // Viewers may see shapes but never grab/move/resize them.
          obj.selectable = !readOnlyRef.current;
          obj.evented = !readOnlyRef.current;
          fc.add(obj);
          if (prevSelectedId && el.id === prevSelectedId) fc.setActiveObject(obj);
        }
      }

      // Anything rebuilt was appended, so it now sits on top of its own layer.
      if (structureChanged) restack(fc);
      countBuild(built);
      fc.renderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [elements, imageCache]);

    /* ── read-only: objects are inspectable but never interactive ── */
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc) return;
      fc.skipTargetFind = readOnly || isConnectorTool(useCanvasStore.getState().activeTool);
      if (readOnly) {
        fc.discardActiveObject();
        fc.selection = false;
      }
      fc.getObjects().forEach((o) => {
        o.selectable = !readOnly;
        o.evented = !readOnly;
      });
      fc.renderAll();
    // `elements`/`imageCache` are still deps: an object built while this effect
    // was not running must still get the current interactivity. It is a property
    // set per object with no allocation, unlike the sync above.
    }, [readOnly, elements, imageCache]);

    /* ── sync store selection → canvas active object(s) ──────────── */
    // Item 1: this used to read `selectedElementId` only, so selecting a group
    // or shift-clicking several rows in the layers panel highlighted exactly one
    // shape on the canvas and moved exactly one. A multi-selection is an
    // ActiveSelection in Fabric, so build one.
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc) return;
      const all = fc.getObjects() as (FabricObject & { data?: Element })[];

      if (selectedElementIds.length === 0) {
        if (fc.getActiveObject()) {
          fc.discardActiveObject();
          fc.requestRenderAll();
        }
        return;
      }

      const wanted = new Set(selectedElementIds);
      const objects = all.filter((o) => o.data?.id && wanted.has(o.data.id));
      if (objects.length === 0) return;

      const active = fc.getActiveObject();
      if (objects.length === 1) {
        if (active !== objects[0]) {
          fc.discardActiveObject();
          fc.setActiveObject(objects[0]);
          fc.requestRenderAll();
        }
        return;
      }

      // Already showing exactly this set? Leave it alone — rebuilding mid-drag
      // would drop the object from under the cursor.
      if (active instanceof ActiveSelection) {
        const current = active.getObjects() as (FabricObject & { data?: Element })[];
        const same = current.length === objects.length
          && current.every((o) => o.data?.id && wanted.has(o.data.id));
        if (same) return;
      }
      fc.discardActiveObject();
      const selection = new ActiveSelection(objects, { canvas: fc });
      fc.setActiveObject(selection);
      fc.requestRenderAll();
    }, [selectedElementIds, selectedElementId, elements, imageCache]);

    /* ── tool + interaction handlers ────────────────────────────── */
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc) return;

      // Fabric 7 does not create a default freeDrawingBrush, so isDrawingMode alone
      // draws nothing. Build one and keep it in sync with the current stroke.
      if (!fc.freeDrawingBrush) fc.freeDrawingBrush = new PencilBrush(fc);
      fc.freeDrawingBrush.color = LINE_STROKE;
      fc.freeDrawingBrush.width = LINE_WIDTH;
      fc.isDrawingMode = activeTool === "path" && !readOnly;
      fc.selection = activeTool === "select" && !readOnly;
      // A line or arrow may START on a shape — that is how it docks to one — so
      // with those tools a press never grabs the shape underneath.
      fc.skipTargetFind = readOnly || isConnectorTool(activeTool);

      if (activeTool === "hand") {
        fc.defaultCursor = "grab";
        fc.hoverCursor = "grab";
        fc.selection = false;
      } else {
        fc.defaultCursor = "default";
        fc.hoverCursor = "move";
      }

      let startX = 0, startY = 0, drawing = false;
      /** The anchor a connector being drawn starts docked to. */
      let startAnchor: Anchor | null = null;
      const connectorTool = isConnectorTool(activeTool);

      /** Snap radius in scene units: a constant 14 screen px at any zoom. */
      const snapRadius = () => SNAP_PX / (fc.getZoom() || 1);
      const liveElements = () => useCanvasStore.getState().elements;

      /**
       * The four edge midpoints of the shape under the pointer, drawn as dots,
       * the one a connector would dock to filled in. Transient objects (no
       * element), so the reconcile leaves them alone.
       */
      const anchorMarkers: FabricObject[] = [];
      const clearAnchors = () => {
        for (const m of anchorMarkers) fc.remove(m);
        anchorMarkers.length = 0;
      };
      const showAnchors = (target: Element | null, active: Anchor | null) => {
        clearAnchors();
        const zoom = fc.getZoom() || 1;
        const shapes = new Map<string, Element>();
        if (target) shapes.set(target.id, target);
        if (active) {
          const owner = liveElements().find((el) => el.id === active.id);
          if (owner) shapes.set(owner.id, owner);
        }
        for (const shape of shapes.values()) {
          for (const a of anchorsOf(shape)) {
            const on = !!active && active.id === a.id && active.side === a.side;
            const r = (on ? 6 : 4.5) / zoom;
            const dot = new Circle({
              left: a.x - r, top: a.y - r, radius: r,
              fill: on ? "#2563eb" : "#ffffff",
              stroke: "#2563eb", strokeWidth: 1.5 / zoom,
              selectable: false, evented: false, objectCaching: false,
            });
            (dot as FabricObject & { anchorMarker?: string }).anchorMarker = `${a.id}:${a.side}`;
            anchorMarkers.push(dot);
            fc.add(dot);
          }
        }
        fc.requestRenderAll();
      };
      // Screen-space origin of the gesture. The scene-space one moves with the
      // zoom, so "did they drag or just click?" can only be asked here: at 8x
      // zoom a 2px twitch is 16 scene px and would pass a scene-space test.
      let startClientX = 0, startClientY = 0;

      const onMouseDown = async (opt: { e: MouseEvent; target?: FabricObject & { data?: Element } }) => {
        const e = opt.e;

        // Hand tool: start panning
        if (activeTool === "hand") {
          handPanningRef.current = true;
          handPanLastRef.current = { x: e.clientX, y: e.clientY };
          fc.setCursor("grabbing");
          return;
        }

        if (spaceHeldRef.current || e.altKey || e.button === 1) return;
        if (activeTool === "select" || activeTool === "path" || activeTool === "image") return;

        // A click that lands on an existing item is about THAT item — select it
        // and hand the tool back to the pointer. Without this, a creation tool
        // did both at once: Fabric had already made the item active and set up a
        // move transform, while this handler started drawing a second shape on
        // top of it. Dragging an item therefore smeared a new rect across it,
        // and clicking a text to edit dropped a fresh "Text" over the old one.
        const hit = opt.target;
        if (hit?.data?.id && !readOnlyRef.current) {
          selectWithPointer(hit.data.id);
          fc.selection = true;
          return;
        }

        // Viewers may pan/select to inspect, but never create.
        if (readOnlyRef.current) return;

        if (activeTool === "text") {
          const p = fc.getScenePoint(e);
          const el: Element = {
            id: uuid(),
            data: { kind: "text", content: "Text", fontSize: 24, fontFamily: "sans-serif", bold: false, italic: false },
            x: Math.round(p.x), y: Math.round(p.y),
            width: 200, height: 36,
            rotation: 0, fill: "#111111", stroke: "transparent", strokeWidth: 0, opacity: 100,
            layerIndex: nextLayerIndex(elements),
            createdBy: "", createdAt: Date.now(), updatedAt: Date.now(),
          };
          const itext = new IText("Text", {
            left: el.x, top: el.y, fontSize: 24, fontFamily: "sans-serif",
            fill: "#111111", opacity: 1, data: el,
          });
          snapshot();
          upsertElement(el);
          fc.add(itext);
          fc.setActiveObject(itext);
          itext.enterEditing();
          itext.selectAll();
          fc.renderAll();
          // Selected, not cleared: `setTool` on its own would empty the selection,
          // and the selection->canvas effect would then discard the active object
          // out from under the caret, ending the edit before it began.
          selectWithPointer(el.id);
          await rpcCall(contextId, "add_element", { element: el }).catch((e) => reportFailure.current("add_element", e));
          return;
        }

        const p = fc.getScenePoint(e);
        startX = p.x; startY = p.y; drawing = true;
        startAnchor = null;
        if (connectorTool) {
          startAnchor = nearestAnchor(liveElements(), p, snapRadius());
          if (startAnchor) { startX = startAnchor.x; startY = startAnchor.y; }
        }
        startClientX = e.clientX; startClientY = e.clientY;
      };

      const onMouseMove = (opt: { e: MouseEvent }) => {
        const e = opt.e;

        // Hand tool panning
        if (handPanningRef.current && activeTool === "hand") {
          const dx = e.clientX - handPanLastRef.current.x;
          const dy = e.clientY - handPanLastRef.current.y;
          handPanLastRef.current = { x: e.clientX, y: e.clientY };
          fc.relativePan(new Point(dx, dy));
          const vpt = fc.viewportTransform;
          if (vpt) onViewportChangeRef.current?.(fc.getZoom(), vpt[4], vpt[5]);
          return;
        }

        // Connector tools show where they would dock, drawing or not.
        let p = fc.getScenePoint(e);
        if (connectorTool && !readOnlyRef.current) {
          const exclude = new Set(startAnchor ? [startAnchor.id] : []);
          const snap = nearestAnchor(liveElements(), p, snapRadius(), exclude);
          const hover = shapeUnder(liveElements().filter((el) => !exclude.has(el.id)), p, snapRadius());
          showAnchors(hover ?? (snap ? liveElements().find((el) => el.id === snap.id) ?? null : null), snap);
          if (drawing && snap) p = new Point(snap.x, snap.y);
        }

        // Live shape preview
        if (!drawing) return;
        const w = Math.max(Math.abs(p.x - startX), 1);
        const h = Math.max(Math.abs(p.y - startY), 1);
        const x = Math.min(p.x, startX);
        const y = Math.min(p.y, startY);

        if (previewObjRef.current) {
          fc.remove(previewObjRef.current);
          previewObjRef.current = null;
        }

        const previewProps = {
          left: x, top: y,
          fill: "rgba(79,142,247,0.15)",
          stroke: "#4F8EF7",
          strokeWidth: 1.5,
          strokeDashArray: [6, 3],
          selectable: false,
          evented: false,
          opacity: 0.85,
        };

        let prev: FabricObject;
        if (activeTool === "circle") {
          prev = new Circle({ ...previewProps, radius: Math.max(w, h) / 2, width: w, height: h });
        } else if (isShapeKind(activeTool)) {
          // The real outline, so a star looks like a star while it is dragged.
          prev = new Path(shapePath(activeTool, w, h), previewProps);
        } else if (activeTool === "rounded") {
          const r = Math.min(ROUNDED_CORNER_RADIUS, Math.min(w, h) / 2);
          prev = new Rect({ ...previewProps, width: w, height: h, rx: r, ry: r });
        } else if (activeTool === "line" || activeTool === "arrow") {
          prev = new Line([startX, startY, p.x, p.y], {
            stroke: "#4F8EF7", strokeWidth: 1.5, strokeDashArray: [6, 3],
            selectable: false, evented: false,
          });
        } else {
          prev = new Rect({ ...previewProps, width: w, height: h });
        }

        previewObjRef.current = prev;
        fc.add(prev);
        fc.renderAll();
      };

      const onMouseUp = async (opt: { e: MouseEvent }) => {
        const e = opt.e;

        // Hand tool: stop panning
        if (handPanningRef.current) {
          handPanningRef.current = false;
          fc.setCursor("grab");
          return;
        }

        if (spaceHeldRef.current || e.altKey) return;
        if (!drawing || activeTool === "select" || activeTool === "text" || activeTool === "path" || activeTool === "image") return;
        drawing = false;

        // Remove preview
        if (previewObjRef.current) {
          fc.remove(previewObjRef.current);
          previewObjRef.current = null;
        }

        // A click is not a drag. Below the threshold the gesture produced no
        // shape to speak of — a zero-length line, or a rect the 20px floor below
        // invents out of nothing — so create nothing at all and leave the tool
        // armed for a real drag.
        const isClick =
          Math.abs(e.clientX - startClientX) < MIN_DRAG_PX &&
          Math.abs(e.clientY - startClientY) < MIN_DRAG_PX;

        // A sticky note is placed, not drawn: a click puts a standard-size note
        // centred under the pointer and opens it for typing straight away.
        if (activeTool === "sticky") {
          const p = fc.getScenePoint(e);
          const sticky = newSticky(uuid(), p.x, p.y, nextLayerIndex(elements));
          if (!isClick) {
            // Dragged: the drag is the note's size, with a floor so it stays usable.
            const dw = Math.max(Math.abs(p.x - startX), 80);
            const dh = Math.max(Math.abs(p.y - startY), 80);
            Object.assign(sticky, {
              x: Math.round(Math.min(p.x, startX)), y: Math.round(Math.min(p.y, startY)),
              width: Math.round(dw), height: Math.round(dh),
            });
          }
          snapshot();
          upsertElement(sticky);
          startTextEdit(sticky.id);
          await rpcCall(contextId, "add_element", { element: sticky }).catch((err) => reportFailure.current("add_element", err));
          return;
        }

        if (isClick) {
          fc.renderAll();
          return;
        }

        clearAnchors();
        const raw = fc.getScenePoint(e);
        // A connector's far end docks too — never to the shape it started on.
        const endAnchor = connectorTool
          ? nearestAnchor(liveElements(), raw, snapRadius(), new Set(startAnchor ? [startAnchor.id] : []))
          : null;
        const p = endAnchor ? new Point(endAnchor.x, endAnchor.y) : raw;
        const segment = activeTool === "line" || activeTool === "arrow";
        // A horizontal line is legitimately 0 tall — only area shapes get a floor.
        const w = segment ? Math.abs(p.x - startX) : Math.max(Math.abs(p.x - startX), 20);
        const h = segment ? Math.abs(p.y - startY) : Math.max(Math.abs(p.y - startY), 20);
        const x = Math.min(p.x, startX);
        const y = Math.min(p.y, startY);

        const isSegment = activeTool === "line" || activeTool === "arrow";
        let el: Element;
        if (isSegment) {
          // item 2: a segment's stroke is the shape, and the bounding box loses which
          // way it was dragged — so keep the endpoints, element-local.
          const points = `${Math.round(startX - x)},${Math.round(startY - y)} ${Math.round(p.x - x)},${Math.round(p.y - y)}`;
          el = {
            id: uuid(),
            data: { kind: activeTool === "arrow" ? "arrow" : "line", points },
            x: Math.round(x), y: Math.round(y),
            width: Math.round(Math.abs(p.x - startX)),
            height: Math.round(Math.abs(p.y - startY)),
            rotation: 0,
            fill: "transparent",
            stroke: LINE_STROKE,
            strokeWidth: LINE_WIDTH,
            opacity: 100,
            layerIndex: nextLayerIndex(elements),
            createdBy: "", createdAt: Date.now(), updatedAt: Date.now(),
            ...(startAnchor ? { startBinding: formatBinding(startAnchor) } : {}),
            ...(endAnchor ? { endBinding: formatBinding(endAnchor) } : {}),
          };
        } else {
          // Every area shape starts as an outline — no fill, a 4px stroke — so
          // it works as a container out of the box.
          const { kind, shape, ...paint } = shapeDefaults(activeTool);
          // A circle is as wide as it is tall: the preview drew max(w, h), so
          // anything else would put down a different shape from the one shown.
          const cw = kind === "circle" ? Math.max(w, h) : w;
          const ch = kind === "circle" ? Math.max(w, h) : h;
          el = {
            id: uuid(),
            data: shape ? { kind, points: shapePath(shape, cw, ch) } : { kind },
            x: Math.round(x), y: Math.round(y),
            width: Math.round(cw),
            height: Math.round(ch),
            rotation: 0,
            ...paint,
            opacity: 100,
            layerIndex: nextLayerIndex(elements),
            createdBy: "", createdAt: Date.now(), updatedAt: Date.now(),
            ...(shape ? { shape } : {}),
          };
        }
        snapshot();
        upsertElement(el);
        // The shape is down; the next gesture is almost always about moving or
        // resizing it, so give the pointer back rather than arming another draw.
        selectWithPointer(el.id);
        await rpcCall(contextId, "add_element", { element: el }).catch((e) => reportFailure.current("add_element", e));
      };

      /** A finished pen stroke: persist it as a `path` element. */
      const onPathCreated = async (opt: { path?: Path }) => {
        if (readOnlyRef.current) return;
        const path = opt.path;
        if (!path) return;
        // Fabric's Path keeps its commands as arrays; join them back into path data.
        const commands = (path as unknown as { path?: (string | number)[][] }).path ?? [];
        const points = commands.map((c) => c.join(" ")).join(" ");
        if (!points) return;

        const el: Element = {
          id: uuid(),
          data: { kind: "path", points },
          x: Math.round(path.left ?? 0),
          y: Math.round(path.top ?? 0),
          width: Math.round(path.getScaledWidth?.() ?? 1),
          height: Math.round(path.getScaledHeight?.() ?? 1),
          rotation: 0,
          fill: "transparent",
          stroke: LINE_STROKE,
          strokeWidth: LINE_WIDTH,
          opacity: 100,
          layerIndex: nextLayerIndex(useCanvasStore.getState().elements),
          createdBy: "", createdAt: Date.now(), updatedAt: Date.now(),
        };
        path.set({ data: el });
        snapshot();
        upsertElement(el);
        await rpcCall(contextId, "add_element", { element: el }).catch((e) => reportFailure.current("add_element", e));
      };

      /** Persist one object's geometry from its current absolute position. */
      const persistGeometry = async (obj: FabricObject & { data?: Element }) => {
        const el = obj.data;
        if (!el?.id) return;
        // An area shape's size is its box, NOT its painted bounds.
        // `getScaledWidth()` includes the stroke, so with the 4px default border
        // every move of a rect used to grow it by 4px — invisible back when new
        // shapes had no stroke at all.
        const area = isAreaShape(el);
        const updatedEl: Element = {
          ...el,
          x: Math.round(obj.left ?? el.x),
          y: Math.round(obj.top ?? el.y),
          width: Math.round(area ? (obj.width ?? el.width) * (obj.scaleX ?? 1) : obj.getScaledWidth?.() ?? el.width),
          height: Math.round(area ? (obj.height ?? el.height) * (obj.scaleY ?? 1) : obj.getScaledHeight?.() ?? el.height),
          rotation: Math.round(obj.angle ?? el.rotation),
          updatedAt: Date.now(),
        };
        obj.data = updatedEl;
        upsertElement(updatedEl);
        await rpcCall(contextId, "update_element", {
          id: updatedEl.id, x: updatedEl.x, y: updatedEl.y,
          width: updatedEl.width, height: updatedEl.height, rotation: updatedEl.rotation,
          fill: null, stroke: null, stroke_width: null, opacity: null,
          corner_radius: null, updated_at: updatedEl.updatedAt,
        }).catch((e) => reportFailure.current("update_element", e));
      };

      const onObjectModified = async (opt: { target?: FabricObject & { data?: Element } }) => {
        if (readOnlyRef.current) return;
        const obj = opt.target;

        // item 1: dragging a marquee selection hands us an ActiveSelection, which
        // carries no `.data` — the old guard returned here and nothing was saved.
        // Children hold group-relative coords, so discard the selection first to
        // get absolute ones back, persist, then restore it.
        // Duck-typed rather than `instanceof ActiveSelection`: a multi-selection is
        // the object that has children and no element of its own. (An arrow is a
        // Group *with* data, so it correctly takes the single-object path below.)
        const asGroup = obj as (FabricObject & { data?: Element; getObjects?: () => FabricObject[] });
        if (obj && !obj.data && typeof asGroup.getObjects === "function") {
          const children = asGroup.getObjects!() as (FabricObject & { data?: Element })[];
          fc.discardActiveObject();
          snapshot();
          for (const child of children) await persistGeometry(child);
          const movedIds = new Set(children.map((c) => c.data?.id).filter(Boolean) as string[]);
          for (const child of children) if (child.data) await detachIfMoved(child.data, movedIds);
          const restored = new ActiveSelection(children, { canvas: fc });
          fc.setActiveObject(restored);
          fc.requestRenderAll();
          return;
        }

        if (!obj?.data?.id) return;

        // A box or sticky resizes its container; only a bare text scales its font.
        if (obj.data.data?.kind === "text" && !isBoxText(obj.data)) {
          const text = obj as IText & { data?: Element };
          const sy = text.scaleY ?? 1;
          const sx = text.scaleX ?? 1;
          if (Math.abs(sy - 1) > 0.001 || Math.abs(sx - 1) > 0.001) {
            const el = text.data!;
            const nextSize = Math.max(4, Math.round((el.data.fontSize ?? 24) * sy));
            const nextWidth = Math.max(20, Math.round((text.width ?? el.width) * sx));
            text.set({ fontSize: nextSize, width: nextWidth, scaleX: 1, scaleY: 1 });
            const updated: Element = {
              ...el,
              data: { ...el.data, fontSize: nextSize },
              width: nextWidth,
              height: Math.round(text.getScaledHeight?.() ?? el.height),
              x: Math.round(text.left ?? el.x),
              y: Math.round(text.top ?? el.y),
              updatedAt: Date.now(),
            };
            text.data = updated;
            snapshot();
            upsertElement(updated);
            fc.requestRenderAll();
            await rpcCall(contextId, "update_text_style", {
              id: updated.id, content: null, font_family: null, font_size: nextSize,
              bold: null, italic: null, updated_at: updated.updatedAt,
            }).catch((e) => reportFailure.current("update_text_style", e));
            await rpcCall(contextId, "update_element", {
              id: updated.id, x: updated.x, y: updated.y,
              width: updated.width, height: updated.height, rotation: updated.rotation,
              fill: null, stroke: null, stroke_width: null, opacity: null,
              corner_radius: null, updated_at: updated.updatedAt,
            }).catch((e) => reportFailure.current("update_element", e));
            return;
          }
        }

        snapshot();
        await persistGeometry(obj);
        if (obj.data && isConnector(obj.data)) await detachIfMoved(obj.data, new Set([obj.data.id]));
      };

      /** Save a connector the user dragged on its own without its dock(s). */
      const detachIfMoved = async (el: Element, movedIds: ReadonlySet<string>) => {
        if (!isConnector(el) || (!el.startBinding && !el.endBinding)) return;
        const current = useCanvasStore.getState().elements.find((x) => x.id === el.id) ?? el;
        const next = detachMoved(current, movedIds);
        if (next.startBinding === current.startBinding && next.endBinding === current.endBinding) return;
        const saved = { ...next, updatedAt: Date.now() };
        upsertElement(saved);
        await rpcCall(contextId, "add_element", { element: saved }).catch((err) => reportFailure.current("add_element", err));
      };

      /**
       * While a docked shape is dragged, redraw its connectors from where it is
       * NOW, so the lines stretch along live instead of jumping on release. The
       * saved reroute happens once, from the reroute effect, after the drop.
       */
      const onObjectMoving = (opt: { target?: FabricObject & { data?: Element } }) => {
        const obj = opt.target;
        const el = obj?.data;
        if (!obj || !el?.id || isConnector(el)) return;
        const all = useCanvasStore.getState().elements;
        const docked = all.filter((c) =>
          isConnector(c) && (parseBinding(c.startBinding)?.id === el.id || parseBinding(c.endBinding)?.id === el.id));
        if (docked.length === 0) return;
        const moved: Element = {
          ...el,
          x: obj.left ?? el.x,
          y: obj.top ?? el.y,
          width: (obj.width ?? el.width) * (obj.scaleX ?? 1),
          height: (obj.height ?? el.height) * (obj.scaleY ?? 1),
          rotation: obj.angle ?? el.rotation,
        };
        const byId = new Map(all.map((x) => [x.id, x] as const));
        byId.set(el.id, moved);
        for (const c of docked) {
          const [a, b] = routedEndpoints(c, byId);
          const { points, ...box } = connectorGeometry(a, b);
          const next = buildFabricObject({ ...c, ...box, data: { ...c.data, points } });
          const old = (fc.getObjects() as CanvasObject[]).find((o) => o.data?.id === c.id);
          if (!next) continue;
          next.selectable = !readOnlyRef.current;
          next.evented = !readOnlyRef.current;
          if (old) fc.remove(old);
          fc.add(next);
        }
        restack(fc);
        fc.requestRenderAll();
      };

      const onTextEditingExited = async (opt: { target?: (IText & { data?: Element }) }) => {
        if (readOnlyRef.current) return;
        const obj = opt.target;
        if (!obj?.data?.id || obj.data.data?.kind !== "text") return;
        const el = obj.data;
        const newContent = obj.text ?? "";
        const updatedEl: Element = { ...el, data: { ...el.data, content: newContent }, updatedAt: Date.now() };
        obj.data = updatedEl;
        snapshot();
        upsertElement(updatedEl);
        await rpcCall(contextId, "update_text_style", {
          id: el.id, content: newContent, font_family: null, font_size: null,
          bold: null, italic: null, updated_at: updatedEl.updatedAt,
        }).catch((e) => reportFailure.current("update_text_style", e));
      };

      const onSelectionCreated = () => {
        // The WHOLE active set, not `opt.selected`: on "selection:updated" that
        // holds only the object just added, so ⌘-clicking a second shape used to
        // shrink the store's selection to that one shape — and the store→canvas
        // sync then tore the multi-selection down to match.
        const ids = (fc.getActiveObjects() as (FabricObject & { data?: Element })[])
          .map((o) => o.data?.id)
          .filter(Boolean) as string[];
        if (ids.length === 1) {
          selectElement(ids[0]);
        } else if (ids.length > 1) {
          selectElements(ids);
        }
      };

      /**
       * Double-click to type: into a box or sticky directly, and into a plain
       * rectangle by first turning it into a box — the Figma/Excalidraw gesture
       * for "put a label in this".
       */
      const onDoubleClick = async (opt: { target?: FabricObject & { data?: Element } }) => {
        if (readOnlyRef.current || previewRef.current) return;
        const el = opt.target?.data;
        if (!el?.id) return;
        if (isBoxText(el)) {
          startTextEdit(el.id);
          return;
        }
        if (el.data.kind === "rect") {
          const box = rectToBox(el);
          snapshot();
          upsertElement(box);
          startTextEdit(box.id);
          await rpcCall(contextId, "add_element", { element: box }).catch((err) => reportFailure.current("add_element", err));
        }
      };

      const onKeyDown = async (e: KeyboardEvent) => {
        // Tool shortcuts — single letters, as the toolbar's tooltips promise.
        // Never while typing anywhere, never with a modifier (⌘R reloads, ⌘D
        // bookmarks), and never on a repeat.
        if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !isTyping(fc)) {
          const tool = TOOL_KEYS[e.key.toLowerCase()];
          if (tool && (!readOnlyRef.current || tool === "select" || tool === "hand")) {
            e.preventDefault();
            useCanvasStore.getState().setTool(tool);
            return;
          }
        }
        if (e.code === "Space" && !e.repeat) {
          spaceHeldRef.current = true;
          fc.setCursor("grab");
          return;
        }

        const mod = e.metaKey || e.ctrlKey;

        if (mod && e.key === "z" && !e.shiftKey) {
          e.preventDefault();
          if (!readOnlyRef.current) undo();
          return;
        }
        if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
          e.preventDefault();
          if (!readOnlyRef.current) redo();
          return;
        }
        if (mod && e.key === "c") {
          // Every selected element, not just the active object. An
          // ActiveSelection carries no `.data` of its own, so reading
          // `getActiveObject().data` saw `undefined` for a multi-selection and
          // copied NOTHING — the same bug the delete path below was already
          // fixed for. The store's selection is the source of truth either way.
          const byId = new Map(
            useCanvasStore.getState().elements.map((el) => [el.id, el] as const),
          );
          const ids = useCanvasStore.getState().selectedElementIds;
          const picked = ids
            .map((id) => byId.get(id))
            .filter((el): el is Element => !!el);
          if (picked.length > 0) copyElements(picked);
          return;
        }
        if (mod && e.key === "v") {
          if (readOnlyRef.current) return;
          const pasted = getPasted();
          if (pasted.length === 0) return;
          e.preventDefault();

          // Drop the current selection BEFORE the elements land. The reconcile
          // that builds the new shapes bails out while an ActiveSelection is up
          // (it would otherwise destroy a live multi-selection), so holding one
          // here means the pasted objects never get created and there is
          // nothing to select afterwards.
          fc.discardActiveObject();

          for (const el of pasted) upsertElement(el);
          snapshot();
          // Select the copies, not the originals: a paste you cannot
          // immediately drag is a paste you have to go and find.
          selectElements(pasted.map((el) => el.id));

          await Promise.all(
            pasted.map((el) =>
              rpcCall(contextId, "add_element", { element: el }).catch((err) =>
                reportFailure.current("add_element", err),
              ),
            ),
          );
          return;
        }

        // ⌘G / ⇧⌘G are handled in CanvasPage: grouping is a label change in
        // contract state (see utils/groups), not a Fabric Group. The old handler
        // here built a local Fabric Group that no peer ever saw and that the very
        // next elements→canvas sync threw away.

        // Delete / Backspace / Escape remove the selection
        if (e.key !== "Delete" && e.key !== "Backspace" && e.key !== "Escape") return;
        if (previewRef.current) return;
        // While placing a comment, Escape cancels that (handled in CanvasPage) —
        // don't also delete the selected shape.
        if (e.key === "Escape" && addingCommentRef.current) return;
        const focusedTag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
        if (focusedTag === "input" || focusedTag === "textarea" || focusedTag === "select") return;
        const active = fc.getActiveObject() as (FabricObject & { data?: Element }) | null;
        if (active?.type === "i-text" && (active as IText).isEditing) return;

        // Every selected element, not just the active object: an ActiveSelection
        // carries no `.data` of its own, so the old guard returned here and a
        // multi-selection could not be deleted at all.
        const ids = useCanvasStore.getState().selectedElementIds;
        const targets = ids.length > 0
          ? ids
          : active?.data?.id
            ? [active.data.id]
            : [];
        // Nothing selected: Escape does nothing at all. It must not fall through
        // to anything else on the page.
        if (targets.length === 0) return;
        e.preventDefault();
        if (readOnlyRef.current) return; // viewers can't delete

        fc.discardActiveObject();
        for (const obj of fc.getObjects() as (FabricObject & { data?: Element })[]) {
          if (obj.data?.id && targets.includes(obj.data.id)) fc.remove(obj);
        }
        fc.requestRenderAll();
        snapshot();
        selectElements([]);
        for (const id of targets) {
          removeElement(id);
          await rpcCall(contextId, "delete_element", { id })
            .catch((err) => reportFailure.current("delete_element", err));
        }
      };

      const onKeyUp = (e: KeyboardEvent) => {
        if (e.code === "Space") {
          spaceHeldRef.current = false;
          fc.setCursor("default");
        }
      };

      fc.on("mouse:down", onMouseDown as (e: unknown) => void);
      fc.on("mouse:move", onMouseMove as (e: unknown) => void);
      fc.on("mouse:up", onMouseUp as (e: unknown) => void);
      fc.on("object:modified", onObjectModified as (e: unknown) => void);
      fc.on("path:created", onPathCreated as (e: unknown) => void);
      fc.on("text:editing:exited", onTextEditingExited as (e: unknown) => void);
      fc.on("selection:created", onSelectionCreated as (e: unknown) => void);
      fc.on("selection:updated", onSelectionCreated as (e: unknown) => void);
      const onSelectionCleared = () => selectElement(null);
      fc.on("selection:cleared", onSelectionCleared);
      fc.on("mouse:dblclick", onDoubleClick as (e: unknown) => void);
      fc.on("object:moving", onObjectMoving as (e: unknown) => void);
      fc.on("object:scaling", onObjectMoving as (e: unknown) => void);
      fc.on("object:rotating", onObjectMoving as (e: unknown) => void);
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);

      return () => {
        // By handler, never by name: `fc.off("mouse:down")` drops every listener
        // for the event, and this effect re-runs on each tool change — so the
        // space/alt-drag pan handlers registered once at mount were torn down
        // the first time anyone picked a tool, and never came back.
        fc.off("mouse:down", onMouseDown as (e: unknown) => void);
        fc.off("mouse:move", onMouseMove as (e: unknown) => void);
        fc.off("mouse:up", onMouseUp as (e: unknown) => void);
        fc.off("object:modified", onObjectModified as (e: unknown) => void);
        fc.off("path:created", onPathCreated as (e: unknown) => void);
        fc.off("text:editing:exited", onTextEditingExited as (e: unknown) => void);
        fc.off("selection:created", onSelectionCreated as (e: unknown) => void);
        fc.off("selection:updated", onSelectionCreated as (e: unknown) => void);
        fc.off("selection:cleared", onSelectionCleared);
        fc.off("mouse:dblclick", onDoubleClick as (e: unknown) => void);
        fc.off("object:moving", onObjectMoving as (e: unknown) => void);
        fc.off("object:scaling", onObjectMoving as (e: unknown) => void);
        fc.off("object:rotating", onObjectMoving as (e: unknown) => void);
        clearAnchors();
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        if (previewObjRef.current) { fc.remove(previewObjRef.current); previewObjRef.current = null; }
      };
    }, [activeTool, readOnly, contextId, elements.length, selectElement, selectElements, selectWithPointer, upsertElement, removeElement, snapshot, undo, redo, copyElements, getPasted, startTextEdit]);

    useEffect(() => {
      (canvasElRef.current as (HTMLCanvasElement & { _cacheImage?: typeof cacheImage }) | null)!._cacheImage = cacheImage;
    }, [cacheImage]);

    /* ── docked connectors follow their shapes ─────────────────────── */
    // Whenever a shape moves — dragged here, nudged in the inspector, moved by a
    // peer — recompute the connectors docked to it. `reroute` returns nothing
    // once they are in place, so this settles after one pass. Saving is batched:
    // scrubbing X in the inspector changes the shape on every pointer move.
    const rerouteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reroutePendingRef = useRef(new Set<string>());
    useEffect(() => {
      const moved = reroute(elements);
      if (moved.length === 0) return;
      for (const c of moved) {
        upsertElement(c);
        reroutePendingRef.current.add(c.id);
      }
      if (readOnlyRef.current) { reroutePendingRef.current.clear(); return; }
      if (rerouteTimerRef.current) clearTimeout(rerouteTimerRef.current);
      rerouteTimerRef.current = setTimeout(() => {
        const ids = [...reroutePendingRef.current];
        reroutePendingRef.current.clear();
        const now = useCanvasStore.getState().elements;
        for (const id of ids) {
          const c = now.find((x) => x.id === id);
          if (!c) continue;
          rpcCall(contextId, "add_element", { element: c }).catch((err) => reportFailure.current("add_element", err));
        }
      }, REROUTE_SAVE_MS);
    }, [elements, upsertElement, contextId]);

    /* ── typing into a box / sticky ───────────────────────────────── */
    const editingEl = editingTextId ? elements.find((e) => e.id === editingTextId && isBoxText(e)) : undefined;

    // Hide the box's own text while the DOM field sits over it.
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc) return;
      for (const o of fc.getObjects()) {
        if (o instanceof BoxRect) {
          const hide = o.element.id === editingTextId;
          if (o.hideText !== hide) { o.hideText = hide; o.dirty = true; }
        }
      }
      fc.requestRenderAll();
    }, [editingTextId, elements]);

    // An edit on an element that went away (deleted by a peer, undone) ends.
    useEffect(() => {
      if (editingTextId && !editingEl) stopTextEdit();
    }, [editingTextId, editingEl, stopTextEdit]);

    async function commitTextEdit(id: string, content: string) {
      stopTextEdit();
      const el = useCanvasStore.getState().elements.find((e) => e.id === id);
      if (!el || readOnlyRef.current) return;
      if (content === (el.data.content ?? "")) {
        // Nothing typed. A box with no words is just a rectangle again.
        if (el.box === "box" && !content.trim()) await revertToRect(el);
        return;
      }
      snapshot();
      if (el.box === "box" && !content.trim()) {
        await revertToRect(el);
        return;
      }
      const now = Date.now();
      const next: Element = { ...el, data: { ...el.data, content }, updatedAt: now };
      // Grow the box to fit what was typed rather than clip it — a sticky that
      // hides its last line looks like lost text.
      const needed = layoutBox(next, el.width, el.height, measurerFor(fontOf(next), next.data.fontSize ?? 16)).neededHeight;
      const grow = needed > el.height;
      if (grow) next.height = needed;
      upsertElement(next);
      await rpcCall(contextId, "update_text_style", {
        id, content, font_family: null, font_size: null, bold: null, italic: null,
        text_align: null, vertical_align: null, updated_at: now,
      }).catch((e) => reportFailure.current("update_text_style", e));
      if (grow) {
        await rpcCall(contextId, "update_element", {
          id, x: null, y: null, width: null, height: next.height, rotation: null,
          fill: null, stroke: null, stroke_width: null, opacity: null, corner_radius: null,
          updated_at: now,
        }).catch((e) => reportFailure.current("update_element", e));
      }
    }

    async function revertToRect(el: Element) {
      const { box: _box, textColor: _ink, ...rest } = el;
      const rect: Element = { ...rest, data: { kind: "rect" }, updatedAt: Date.now() };
      upsertElement(rect);
      await rpcCall(contextId, "add_element", { element: rect }).catch((e) => reportFailure.current("add_element", e));
    }

    function notifyViewport(z: number) {
      const fc = fabricRef.current;
      if (!fc) return;
      const vpt = fc.viewportTransform;
      if (vpt) onViewportChangeRef.current?.(z, vpt[4], vpt[5]);
    }

    return (
      <div className={styles.wrap}>
        <canvas ref={canvasElRef} data-testid="fabric-canvas" />
        {editingEl && fabricRef.current && canvasElRef.current && (
          <TextBoxEditor
            key={editingEl.id}
            element={editingEl}
            canvas={fabricRef.current}
            canvasEl={canvasElRef.current}
            onCommit={(content) => { void commitTextEdit(editingEl.id, content); }}
          />
        )}
        <div className={styles.zoomBar}>
          <button className={styles.zoomBtn} onClick={() => {
            const fc = fabricRef.current;
            if (!fc) return;
            const z = Math.min(40, fc.getZoom() * 1.25);
            fc.zoomToPoint(new Point(fc.width! / 2, fc.height! / 2), z);
            setZoom(z);
            notifyViewport(z);
          }}>+</button>
          <span className={styles.zoomLevel}>{Math.round(zoom * 100)}%</span>
          <button className={styles.zoomBtn} onClick={() => {
            const fc = fabricRef.current;
            if (!fc) return;
            const z = Math.max(0.05, fc.getZoom() / 1.25);
            fc.zoomToPoint(new Point(fc.width! / 2, fc.height! / 2), z);
            setZoom(z);
            notifyViewport(z);
          }}>−</button>
          <button className={styles.zoomBtn} onClick={() => {
            const fc = fabricRef.current;
            if (!fc) return;
            fc.setZoom(1);
            fc.setViewportTransform([1, 0, 0, 1, 0, 0]);
            setZoom(1);
            onViewportChangeRef.current?.(1, 0, 0);
          }}>1:1</button>
        </div>
      </div>
    );
  },
);

FabricCanvas.displayName = "FabricCanvas";
export default FabricCanvas;

/** Default paint for a line/arrow: without it the stroke *is* the shape and there
 *  is nothing to see. */
/**
 * One past the highest layer in use. `elements.length` collides after a delete —
 * two elements then share an index and paint order becomes sort-dependent.
 */
function nextLayerIndex(elements: Element[]): number {
  return elements.reduce((max, e) => Math.max(max, e.layerIndex + 1), 0);
}

/** How close, in screen px, a connector end must come to an anchor to dock. */
const SNAP_PX = 14;
/** Delay before a rerouted connector is saved — see the reroute effect. */
const REROUTE_SAVE_MS = 250;

function isConnectorTool(tool: string): boolean {
  return tool === "line" || tool === "arrow";
}

/** Letter → tool. The toolbar's tooltips show the same letters. */
const TOOL_KEYS: Record<string, Tool> = {
  v: "select", h: "hand", r: "rect", u: "rounded", o: "circle",
  d: "diamond", g: "triangle", x: "star", c: "cloud",
  l: "line", a: "arrow", p: "path", t: "text", s: "sticky",
};

/** True while keystrokes belong to a text field or an IText being edited. */
function isTyping(fc: Canvas): boolean {
  const el = document.activeElement as HTMLElement | null;
  const tag = el?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return true;
  const active = fc.getActiveObject() as (IText & { isEditing?: boolean }) | null;
  return !!active?.isEditing;
}

/** Shapes whose stored size is their box — see `persistGeometry`. */
function isAreaShape(el: Element): boolean {
  return el.data.kind === "rect"
    || el.data.kind === "circle"
    || (el.data.kind === "path" && isShapeKind(el.shape))
    || isBoxText(el);
}

const LINE_STROKE = "#111111";
const LINE_WIDTH = 2;
/**
 * How far, in screen pixels, a press must travel before it counts as drawing a
 * shape rather than clicking. Small enough that a deliberate small shape still
 * lands, large enough to absorb the hand tremor in a click.
 */
const MIN_DRAG_PX = 4;

/**
 * Line/arrow endpoints, absolute. `points` is "x1,y1 x2,y2" in element-local
 * space; elements created before that field existed fall back to the bounding
 * box diagonal, which is all the information they ever had.
 */
function endpoints(el: Element): [number, number, number, number] {
  const raw = el.data.points?.trim();
  if (raw) {
    const nums = raw.split(/[\s,]+/).map(Number);
    if (nums.length >= 4 && nums.every((n) => Number.isFinite(n))) {
      return [el.x + nums[0], el.y + nums[1], el.x + nums[2], el.y + nums[3]];
    }
  }
  return [el.x, el.y, el.x + el.width, el.y + el.height];
}

/** An arrowhead as a triangle at (x2,y2), pointing along the segment. */
function arrowHead(x1: number, y1: number, x2: number, y2: number, width: number, colour: string): Polygon {
  const size = Math.max(8, width * 3.5);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const p = (len: number, spread: number) => ({
    x: x2 - len * Math.cos(angle) + spread * Math.cos(angle + Math.PI / 2),
    y: y2 - len * Math.sin(angle) + spread * Math.sin(angle + Math.PI / 2),
  });
  return new Polygon([{ x: x2, y: y2 }, p(size, size * 0.42), p(size, -size * 0.42)], {
    fill: colour,
    stroke: colour,
    strokeWidth: 1,
    objectCaching: false,
  });
}

function buildFabricObject(el: Element): FabricObject | null {
  const shadow =
    el.shadowBlur != null && el.shadowBlur > 0
      ? new Shadow({
          color: el.shadowColor ?? "rgba(0,0,0,0.3)",
          offsetX: el.shadowOffsetX ?? 0,
          offsetY: el.shadowOffsetY ?? 4,
          blur: el.shadowBlur,
        })
      : undefined;

  const base = {
    left: el.x, top: el.y, width: el.width, height: el.height,
    angle: el.rotation,
    fill: el.fill || "transparent",
    stroke: el.stroke || "transparent",
    strokeWidth: el.strokeWidth,
    opacity: el.opacity / 100,
    shadow,
    data: el,
    ...dashProps(el),
    // A 4px border stays 4px while a shape is being resized, and persisting
    // reads `width * scaleX` (see `persistGeometry`), which excludes it.
    strokeUniform: true,
  };

  switch (el.data.kind) {
    case "rect": {
      // item 14: rounded corners, clamped so a big radius cannot invert the shape
      const r = Math.max(0, Math.min(el.cornerRadius ?? 0, Math.min(el.width, el.height) / 2));
      return new Rect({ ...base, rx: r, ry: r });
    }
    case "circle": return new Circle({ ...base, radius: el.width / 2 });
    case "line":
    case "arrow": {
      // item 2: a line's stroke IS the shape, so "transparent"/0 makes it vanish.
      const colour = isPaintable(el.stroke) ? el.stroke : LINE_STROKE;
      const width = Math.max(1, el.strokeWidth || LINE_WIDTH);
      const [x1, y1, x2, y2] = endpoints(el);
      const line = new Line([x1, y1, x2, y2], {
        stroke: colour, strokeWidth: width, strokeLineCap: "round", shadow,
        strokeDashArray: dashArray(el.strokeStyle, width) ?? null,
      });
      if (el.data.kind === "line") {
        line.set({ data: el });
        return line;
      }
      const group = new Group([line, arrowHead(x1, y1, x2, y2, width, colour)], {
        opacity: el.opacity / 100,
        subTargetCheck: false,
      });
      group.set({ data: el });
      return group;
    }
    case "text": {
      if (isBoxText(el)) {
        const r = Math.max(0, Math.min(el.cornerRadius ?? 0, Math.min(el.width, el.height) / 2));
        return new BoxRect({ ...base, rx: r, ry: r }, el);
      }
      const text = new IText(el.data.content ?? "Text", {
        left: el.x, top: el.y,
        fontSize: el.data.fontSize ?? 24,
        fontFamily: el.data.fontFamily ?? "sans-serif",
        fill: isPaintable(el.fill) ? el.fill : "#111",
        fontWeight: el.data.bold ? "bold" : "normal",
        fontStyle: el.data.italic ? "italic" : "normal",
        textAlign: el.data.text_align ?? "left",
        opacity: el.opacity / 100,
        // Outlined text: stroke under the fill, so the outline grows outward and
        // the glyph stays readable.
        stroke: isPaintable(el.stroke) ? el.stroke : undefined,
        strokeWidth: isPaintable(el.stroke) ? el.strokeWidth : 0,
        paintFirst: "stroke",
        shadow, data: el,
      });
      // item 5: the vertical handles. Present in Fabric 7, stated here so a future
      // default cannot quietly remove them again.
      text.setControlsVisibility({ mt: true, mb: true });
      return text;
    }
    case "path": {
      // A shape tool's outline is rebuilt at the element's size (see
      // utils/shapes); a pen stroke is drawn from its stored points as before.
      if (isShapeKind(el.shape)) {
        return new Path(shapePath(el.shape, el.width, el.height), { ...base, strokeLineJoin: "round" });
      }
      const { strokeUniform: _uniform, ...pen } = base;
      return new Path(el.data.points ?? "", { ...pen, fill: "transparent" });
    }
    default:
      return null;
  }
}

/** Dash pattern and cap for an element's outline, as Fabric props. */
function dashProps(el: Element): { strokeDashArray: number[] | null; strokeLineCap: "round" | "butt" } {
  return {
    strokeDashArray: dashArray(el.strokeStyle, el.strokeWidth) ?? null,
    strokeLineCap: strokeCap(el.strokeStyle),
  };
}

/**
 * A rectangle that also paints its element's text inside itself — a box you can
 * type into, or a sticky note. One Fabric object per element, so selection,
 * resize handles and hit-testing are exactly the box, and nothing has to keep a
 * separate text object glued to it.
 *
 * The text is drawn in UNSCALED space: while a resize handle is being dragged
 * Fabric scales the context, and drawing through that would stretch the glyphs.
 * Undoing the scale and laying out at the scaled size instead re-wraps the words
 * live as the box changes shape.
 */
class BoxRect extends Rect {
  declare element: Element;
  /** Set while the DOM editor is open over this box, so the text is not drawn twice. */
  declare hideText: boolean;

  constructor(options: ConstructorParameters<typeof Rect>[0], element: Element) {
    super(options);
    this.element = element;
    this.hideText = false;
  }

  _render(ctx: CanvasRenderingContext2D): void {
    super._render(ctx);
    const el = this.element;
    if (this.hideText || !el.data.content) return;
    const sx = this.scaleX || 1;
    const sy = this.scaleY || 1;
    const w = this.width * sx;
    const h = this.height * sy;
    ctx.save();
    ctx.scale(1 / sx, 1 / sy);
    // Words never paint outside the box — the box is the element's bounds, and
    // anything drawn beyond them is clipped by Fabric's object cache anyway.
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
    ctx.clip();
    ctx.shadowColor = "transparent";
    ctx.font = fontOf(el);
    ctx.fillStyle = inkOf(el);
    ctx.textBaseline = "top";
    const layout = layoutBox(el, w, h, (t) => ctx.measureText(t).width);
    ctx.textAlign = layout.align;
    layout.lines.forEach((line, i) => {
      ctx.fillText(line, -w / 2 + layout.anchorX, -h / 2 + layout.top + i * layout.lineHeight);
    });
    ctx.restore();
  }
}

