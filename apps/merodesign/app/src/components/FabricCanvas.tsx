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
import { useCanvasStore } from "../store/canvasStore";
import { saveDataUrl, saveText } from "../utils/saveFile";
import type { Element } from "../types";
import styles from "./FabricCanvas.module.css";

// Must run before any Fabric object is constructed — see fabricDefaults.ts.
applyTopLeftOrigin();

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
    const [zoom, setZoom] = useState(1);
    const { showToast } = useToast();
    // See utils/mutationErrors: these used to be `.catch(() => {})`, so a failed
    // save left the canvas looking correct until the next sync silently undid it.
    const reportFailure = useRef(createMutationReporter((m) => showToast(m, "error")));
    reportFailure.current = createMutationReporter((m) => showToast(m, "error"));

    const {
      activeTool,
      selectedElementId,
      selectedElementIds,
      elements,
      background,
      imageCache,
      selectElement,
      selectElements,
      upsertElement,
      removeElement,
      cacheImage,
      snapshot,
      undo,
      redo,
      copyElement,
      getPasted,
    } = useCanvasStore();

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
        await runExport("PNG", () => saveDataUrl(url, "merodesign-export.png"));
      },
      async exportSvg() {
        const svg = withSolidBgData(() => fabricRef.current!.toSVG());
        await runExport("SVG", () => saveText(svg, "merodesign-export.svg", "image/svg+xml"));
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
        await runExport("PNG", () => saveDataUrl(url, "merodesign-selection.png"));
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
          await runExport("SVG", () => saveText(svg, "merodesign-selection.svg", "image/svg+xml"));
        } else {
          const svg = fc.toSVG();
          await runExport("SVG", () => saveText(svg, "merodesign-export.svg", "image/svg+xml"));
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

      /* ── zoom (mouse wheel) ──────────────────────────────────── */
      fc.on("mouse:wheel", (opt) => {
        const e = opt.e as WheelEvent;
        let z = fc.getZoom();
        z *= 0.999 ** e.deltaY;
        z = Math.max(0.05, Math.min(40, z));
        fc.zoomToPoint(new Point(e.offsetX, e.offsetY), z);
        setZoom(z);
        const vpt = fc.viewportTransform;
        if (vpt) onViewportChangeRef.current?.(z, vpt[4], vpt[5]);
        e.preventDefault();
        e.stopPropagation();
      });

      /* ── pan (space + drag or alt + drag) ───────────────────── */
      let panning = false;
      let panLastX = 0;
      let panLastY = 0;

      fc.on("mouse:down", (opt) => {
        const e = opt.e as MouseEvent;
        if (spaceHeldRef.current || e.altKey || e.button === 1) {
          panning = true;
          panLastX = e.clientX;
          panLastY = e.clientY;
          fc.setCursor("grabbing");
          fc.selection = false;
        }
      });
      fc.on("mouse:move", (opt) => {
        if (!panning) return;
        const e = opt.e as MouseEvent;
        const dx = e.clientX - panLastX;
        const dy = e.clientY - panLastY;
        panLastX = e.clientX;
        panLastY = e.clientY;
        fc.relativePan(new Point(dx, dy));
        const vpt = fc.viewportTransform;
        if (vpt) onViewportChangeRef.current?.(fc.getZoom(), vpt[4], vpt[5]);
      });
      fc.on("mouse:up", () => {
        if (panning) {
          panning = false;
          fc.selection = useCanvasStore.getState().activeTool === "select";
          fc.setCursor("default");
        }
      });

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
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc) return;
      const activeObj = fc.getActiveObject() as (IText & { isEditing?: boolean }) | null;
      if (activeObj?.isEditing) return;
      // A rebuild would destroy a live multi-selection: fc.clear() drops the
      // ActiveSelection and the user's drag target vanishes under the cursor.
      if (fc.getActiveObject() instanceof ActiveSelection) return;

      const prevSelectedId = useCanvasStore.getState().selectedElementId;

      fc.clear();
      const src = makeDotPattern(backgroundRef.current);
      fc.set("backgroundColor", new Pattern({ source: src, repeat: "repeat" }));

      const sorted = [...elements].sort((a, b) => a.layerIndex - b.layerIndex);
      for (const el of sorted) {
        if (el.data.kind === "image" || el.data.kind === "svg") {
          const cached = imageCache[el.id];
          if (cached) {
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
              fc.add(img);
              if (prevSelectedId && el.id === prevSelectedId) fc.setActiveObject(img);
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (group as any).data = el;
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
      fc.renderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [elements, imageCache]);

    /* ── read-only: objects are inspectable but never interactive ── */
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc) return;
      fc.skipTargetFind = readOnly;
      if (readOnly) {
        fc.discardActiveObject();
        fc.selection = false;
      }
      fc.getObjects().forEach((o) => {
        o.selectable = !readOnly;
        o.evented = !readOnly;
      });
      fc.renderAll();
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

      if (activeTool === "hand") {
        fc.defaultCursor = "grab";
        fc.hoverCursor = "grab";
        fc.selection = false;
      } else {
        fc.defaultCursor = "default";
        fc.hoverCursor = "move";
      }

      let startX = 0, startY = 0, drawing = false;

      const onMouseDown = async (opt: { e: MouseEvent }) => {
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
          await rpcCall(contextId, "add_element", { element: el }).catch((e) => reportFailure.current("add_element", e));
          return;
        }

        const p = fc.getScenePoint(e);
        startX = p.x; startY = p.y; drawing = true;
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

        // Live shape preview
        if (!drawing) return;
        const p = fc.getScenePoint(e);
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

        const p = fc.getScenePoint(e);
        const segment = activeTool === "line" || activeTool === "arrow";
        // A horizontal line is legitimately 0 tall — only area shapes get a floor.
        const w = segment ? Math.abs(p.x - startX) : Math.max(Math.abs(p.x - startX), 20);
        const h = segment ? Math.abs(p.y - startY) : Math.max(Math.abs(p.y - startY), 20);
        const x = Math.min(p.x, startX);
        const y = Math.min(p.y, startY);

        const kind =
          activeTool === "circle" ? "circle" as const :
          activeTool === "line"   ? "line"   as const :
          activeTool === "arrow"  ? "arrow"  as const :
          "rect" as const;

        const isSegment = kind === "line" || kind === "arrow";
        // item 2: a segment's stroke is the shape, and the bounding box loses which
        // way it was dragged — so keep the endpoints, element-local.
        const points = isSegment
          ? `${Math.round(startX - x)},${Math.round(startY - y)} ${Math.round(p.x - x)},${Math.round(p.y - y)}`
          : undefined;

        const el: Element = {
          id: uuid(),
          data: points ? { kind, points } : { kind },
          x: Math.round(x), y: Math.round(y),
          width: Math.round(isSegment ? Math.abs(p.x - startX) : w),
          height: Math.round(isSegment ? Math.abs(p.y - startY) : h),
          rotation: 0,
          fill: isSegment ? "transparent" : "#4F8EF7",
          stroke: isSegment ? LINE_STROKE : "transparent",
          strokeWidth: isSegment ? LINE_WIDTH : 0,
          opacity: 100,
          layerIndex: nextLayerIndex(elements),
          createdBy: "", createdAt: Date.now(), updatedAt: Date.now(),
        };
        snapshot();
        upsertElement(el);
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
        const updatedEl: Element = {
          ...el,
          x: Math.round(obj.left ?? el.x),
          y: Math.round(obj.top ?? el.y),
          width: Math.round(obj.getScaledWidth?.() ?? el.width),
          height: Math.round(obj.getScaledHeight?.() ?? el.height),
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
          const restored = new ActiveSelection(children, { canvas: fc });
          fc.setActiveObject(restored);
          fc.requestRenderAll();
          return;
        }

        if (!obj?.data?.id) return;

        if (obj.data.data?.kind === "text") {
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

      const onSelectionCreated = (opt: { selected?: (FabricObject & { data?: Element })[] }) => {
        const ids = (opt.selected ?? []).map((o) => o.data?.id).filter(Boolean) as string[];
        if (ids.length === 1) {
          selectElement(ids[0]);
        } else if (ids.length > 1) {
          selectElements(ids);
        }
      };

      const onKeyDown = async (e: KeyboardEvent) => {
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
          const active = fc.getActiveObject() as (FabricObject & { data?: Element }) | null;
          if (active?.data) copyElement(active.data);
          return;
        }
        if (mod && e.key === "v") {
          if (readOnlyRef.current) return;
          const newEl = getPasted();
          if (newEl) {
            upsertElement(newEl);
            snapshot();
            await rpcCall(contextId, "add_element", { element: newEl }).catch((e) => reportFailure.current("add_element", e));
          }
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
      fc.on("selection:cleared", () => selectElement(null));
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);

      return () => {
        fc.off("mouse:down"); fc.off("mouse:move"); fc.off("mouse:up");
        fc.off("object:modified");
        fc.off("path:created");
        fc.off("text:editing:exited"); fc.off("selection:created");
        fc.off("selection:updated"); fc.off("selection:cleared");
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        if (previewObjRef.current) { fc.remove(previewObjRef.current); previewObjRef.current = null; }
      };
    }, [activeTool, readOnly, contextId, elements.length, selectElement, selectElements, upsertElement, removeElement, snapshot, undo, redo, copyElement, getPasted]);

    useEffect(() => {
      (canvasElRef.current as (HTMLCanvasElement & { _cacheImage?: typeof cacheImage }) | null)!._cacheImage = cacheImage;
    }, [cacheImage]);

    function notifyViewport(z: number) {
      const fc = fabricRef.current;
      if (!fc) return;
      const vpt = fc.viewportTransform;
      if (vpt) onViewportChangeRef.current?.(z, vpt[4], vpt[5]);
    }

    return (
      <div className={styles.wrap}>
        <canvas ref={canvasElRef} data-testid="fabric-canvas" />
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

const LINE_STROKE = "#111111";
const LINE_WIDTH = 2;

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
    case "path":
      return new Path(el.data.points ?? "", { ...base, fill: "transparent" });
    default:
      return null;
  }
}
