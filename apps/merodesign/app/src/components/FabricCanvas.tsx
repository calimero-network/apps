import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Canvas,
  Point,
  Rect,
  Circle,
  Line,
  IText,
  FabricImage,
  Path,
  Pattern,
  Shadow,
  Group,
  Text as FabricText,
  type FabricObject,
} from "fabric";
import { v4 as uuid } from "uuid";
import { rpcCall } from "../api/rpc";
import { useCanvasStore } from "../store/canvasStore";
import { downloadDataUrl } from "../utils/export";
import type { Element } from "../types";
import styles from "./FabricCanvas.module.css";

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

    const {
      activeTool,
      selectedElementId,
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

    useImperativeHandle(ref, () => ({
      async exportPng() {
        const url = withSolidBgData(() => fabricRef.current!.toDataURL({ format: "png", multiplier: 2 }));
        await downloadDataUrl(url, "merodesign-export.png");
      },
      async exportSvg() {
        const svg = withSolidBgData(() => fabricRef.current!.toSVG());
        await downloadDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, "merodesign-export.svg");
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
        await downloadDataUrl(url, "merodesign-selection.png");
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
          await downloadDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, "merodesign-selection.svg");
        } else {
          const svg = fc.toSVG();
          await downloadDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, "merodesign-export.svg");
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

      const resize = () => {
        const { w: nw, h: nh } = getSize();
        fc.setWidth(nw);
        fc.setHeight(nh);
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
              img.set({
                left: el.x, top: el.y,
                scaleX: el.width / (img.width || el.width),
                scaleY: el.height / (img.height || el.height),
                angle: el.rotation,
                opacity: el.opacity / 100,
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
              fill: hasBlobId ? "#e8e8e8" : "#fce8e8",
              stroke: hasBlobId ? "#ccc" : "#e09090",
              strokeWidth: 1,
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

    /* ── sync store selectedElementId → canvas active object ────── */
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc || !selectedElementId) return;
      const all = fc.getObjects() as (FabricObject & { data?: Element })[];
      const obj = all.find((o) => o.data?.id === selectedElementId);
      if (obj && fc.getActiveObject() !== obj) {
        fc.setActiveObject(obj);
        fc.renderAll();
      }
    }, [selectedElementId]);

    /* ── tool + interaction handlers ────────────────────────────── */
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc) return;

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
            layerIndex: elements.length,
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
          await rpcCall(contextId, "add_element", { element: el }).catch(() => {});
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
        const w = Math.max(Math.abs(p.x - startX), 20);
        const h = Math.max(Math.abs(p.y - startY), 20);
        const x = Math.min(p.x, startX);
        const y = Math.min(p.y, startY);

        const kind =
          activeTool === "circle" ? "circle" as const :
          activeTool === "line"   ? "line"   as const :
          activeTool === "arrow"  ? "arrow"  as const :
          "rect" as const;

        const el: Element = {
          id: uuid(), data: { kind },
          x: Math.round(x), y: Math.round(y),
          width: Math.round(w), height: Math.round(h),
          rotation: 0, fill: "#4F8EF7", stroke: "transparent", strokeWidth: 0, opacity: 100,
          layerIndex: elements.length,
          createdBy: "", createdAt: Date.now(), updatedAt: Date.now(),
        };
        snapshot();
        upsertElement(el);
        await rpcCall(contextId, "add_element", { element: el }).catch(() => {});
      };

      const onObjectModified = async (opt: { target?: FabricObject & { data?: Element } }) => {
        if (readOnlyRef.current) return;
        const obj = opt.target;
        if (!obj?.data?.id) return;
        const el = obj.data;
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
        snapshot();
        upsertElement(updatedEl);
        await rpcCall(contextId, "update_element", {
          id: updatedEl.id, x: updatedEl.x, y: updatedEl.y,
          width: updatedEl.width, height: updatedEl.height, rotation: updatedEl.rotation,
          fill: null, stroke: null, stroke_width: null, opacity: null, updated_at: updatedEl.updatedAt,
        }).catch(() => {});
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
        }).catch(() => {});
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
            await rpcCall(contextId, "add_element", { element: newEl }).catch(() => {});
          }
          return;
        }

        // Ctrl+G: group selected objects
        if (mod && e.key === "g" && !e.shiftKey) {
          e.preventDefault();
          const active = fc.getActiveObject();
          if (active && "getObjects" in active && typeof (active as { getObjects?: unknown }).getObjects === "function") {
            const objs = (active as { getObjects: () => FabricObject[] }).getObjects();
            if (objs.length > 1) {
              const group = new Group(objs, { selectable: true, evented: true });
              objs.forEach((o) => fc.remove(o));
              fc.discardActiveObject();
              fc.add(group);
              fc.setActiveObject(group);
              fc.renderAll();
            }
          }
          return;
        }

        // Ctrl+Shift+G: ungroup
        if (mod && e.shiftKey && e.key === "G") {
          e.preventDefault();
          const active = fc.getActiveObject() as (FabricObject & { getObjects?: () => FabricObject[] }) | null;
          if (active instanceof Group) {
            const objs = active.getObjects();
            fc.remove(active);
            objs.forEach((o) => { fc.add(o); });
            fc.renderAll();
          }
          return;
        }

        // Delete / Backspace / Escape remove the selected element
        if (e.key !== "Delete" && e.key !== "Backspace" && e.key !== "Escape") return;
        if (previewRef.current) return;
        // While placing a comment, Escape cancels that (handled in CanvasPage) —
        // don't also delete the selected shape.
        if (e.key === "Escape" && addingCommentRef.current) return;
        const focusedTag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
        if (focusedTag === "input" || focusedTag === "textarea" || focusedTag === "select") return;
        const active = fc.getActiveObject() as (FabricObject & { data?: Element }) | null;
        if (!active?.data?.id) return;
        if (active.type === "i-text" && (active as IText).isEditing) return;
        if (readOnlyRef.current) return; // viewers can't delete
        fc.remove(active);
        fc.renderAll();
        snapshot();
        removeElement(active.data.id);
        await rpcCall(contextId, "delete_element", { id: active.data.id }).catch(() => {});
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
      fc.on("text:editing:exited", onTextEditingExited as (e: unknown) => void);
      fc.on("selection:created", onSelectionCreated as (e: unknown) => void);
      fc.on("selection:updated", onSelectionCreated as (e: unknown) => void);
      fc.on("selection:cleared", () => selectElement(null));
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);

      return () => {
        fc.off("mouse:down"); fc.off("mouse:move"); fc.off("mouse:up");
        fc.off("object:modified");
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
    case "rect":   return new Rect(base);
    case "circle": return new Circle({ ...base, radius: el.width / 2 });
    case "line":
    case "arrow":
      return new Line([el.x, el.y, el.x + el.width, el.y + el.height], {
        stroke: el.stroke || "#000", strokeWidth: el.strokeWidth, shadow, data: el,
      });
    case "text":
      return new IText(el.data.content ?? "Text", {
        left: el.x, top: el.y,
        fontSize: el.data.fontSize ?? 24,
        fontFamily: el.data.fontFamily ?? "sans-serif",
        fill: el.fill || "#111",
        fontWeight: el.data.bold ? "bold" : "normal",
        fontStyle: el.data.italic ? "italic" : "normal",
        textAlign: el.data.text_align ?? "left",
        opacity: el.opacity / 100,
        shadow, data: el,
      });
    case "path":
      return new Path(el.data.points ?? "", { ...base, fill: "transparent" });
    default:
      return null;
  }
}
