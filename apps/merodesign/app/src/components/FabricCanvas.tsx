import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  Canvas,
  Rect,
  Circle,
  Line,
  IText,
  FabricImage,
  Path,
  type FabricObject,
} from "fabric";
import { v4 as uuid } from "uuid";
import { rpcCall } from "../api/rpc";
import { useCanvasStore } from "../store/canvasStore";
import { downloadDataUrl } from "../utils/export";
import type { Element } from "../types";
import styles from "./FabricCanvas.module.css";

export interface FabricCanvasHandle {
  exportPng: () => void;
  exportSvg: () => void;
}

interface Props {
  contextId: string;
}

const FabricCanvas = forwardRef<FabricCanvasHandle, Props>(
  ({ contextId }, ref) => {
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<Canvas | null>(null);
    const {
      activeTool,
      elements,
      background,
      imageCache,
      selectElement,
      upsertElement,
      removeElement,
      cacheImage,
    } = useCanvasStore();

    useImperativeHandle(ref, () => ({
      exportPng: () => {
        const fc = fabricRef.current;
        if (!fc) return;
        const url = fc.toDataURL({ format: "png", multiplier: 2 });
        downloadDataUrl(url, "merodesign-export.png");
      },
      exportSvg: () => {
        const fc = fabricRef.current;
        if (!fc) return;
        const svg = fc.toSVG();
        const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        downloadDataUrl(url, "merodesign-export.svg");
      },
    }));

    // Init
    useEffect(() => {
      if (!canvasElRef.current) return;

      const fc = new Canvas(canvasElRef.current, {
        width: window.innerWidth - 220,
        height: window.innerHeight - 48,
        backgroundColor: "#ffffff",
        selection: true,
      });
      fabricRef.current = fc;

      const resize = () => {
        fc.setWidth(window.innerWidth - 220);
        fc.setHeight(window.innerHeight - 48);
        fc.renderAll();
      };
      window.addEventListener("resize", resize);

      return () => {
        window.removeEventListener("resize", resize);
        fc.dispose();
        fabricRef.current = null;
      };
    }, []);

    // Background color
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc) return;
      fc.set("backgroundColor", background);
      fc.renderAll();
    }, [background]);

    // Sync elements from store → canvas
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc) return;

      fc.clear();
      fc.set("backgroundColor", background);

      const sorted = [...elements].sort((a, b) => a.layerIndex - b.layerIndex);

      for (const el of sorted) {
        if (el.data.kind === "Image" || el.data.kind === "Svg") {
          const cached = imageCache[el.id];
          if (cached) {
            FabricImage.fromURL(cached).then((img) => {
              img.set({
                left: el.x,
                top: el.y,
                scaleX: el.width / (img.width || el.width),
                scaleY: el.height / (img.height || el.height),
                angle: el.rotation,
                opacity: el.opacity / 100,
                data: el,
              });
              fc.add(img);
              fc.renderAll();
            });
          } else {
            // placeholder rect while image loads
            const ph = new Rect({
              left: el.x,
              top: el.y,
              width: el.width,
              height: el.height,
              fill: "#e8e8e8",
              stroke: "#ccc",
              strokeWidth: 1,
              data: el,
            });
            fc.add(ph);
          }
          continue;
        }

        const obj = buildFabricObject(el);
        if (obj) fc.add(obj);
      }

      fc.renderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [elements, imageCache]);

    // Tool + interaction handlers
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc) return;

      fc.isDrawingMode = activeTool === "path";
      fc.selection = activeTool === "select";

      let startX = 0;
      let startY = 0;
      let drawing = false;

      const onMouseDown = (opt: { e: MouseEvent }) => {
        if (activeTool === "select" || activeTool === "path" || activeTool === "image") return;
        const p = fc.getScenePoint(opt.e);
        startX = p.x;
        startY = p.y;
        drawing = true;
      };

      const onMouseUp = async (opt: { e: MouseEvent }) => {
        if (!drawing || activeTool === "select" || activeTool === "path" || activeTool === "image") return;
        drawing = false;
        const p = fc.getScenePoint(opt.e);
        const w = Math.max(Math.abs(p.x - startX), 20);
        const h = Math.max(Math.abs(p.y - startY), 20);
        const x = Math.min(p.x, startX);
        const y = Math.min(p.y, startY);

        const el: Element = {
          id: uuid(),
          data: {
            kind:
              activeTool === "circle" ? "Circle"
              : activeTool === "line" ? "Line"
              : activeTool === "arrow" ? "Arrow"
              : activeTool === "text" ? "Text"
              : "Rect",
          },
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(w),
          height: Math.round(h),
          rotation: 0,
          fill: "#ffffff",
          stroke: "#000000",
          strokeWidth: 2,
          opacity: 100,
          layerIndex: elements.length,
          createdBy: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        upsertElement(el);
        await rpcCall(contextId, "add_element", { element: el }).catch(() => {});
      };

      // Sync position/size back to store + RPC when dragged / resized
      const onObjectModified = async (opt: { target?: FabricObject & { data?: Element } }) => {
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
        upsertElement(updatedEl);
        await rpcCall(contextId, "update_element", {
          id: updatedEl.id,
          x: updatedEl.x,
          y: updatedEl.y,
          width: updatedEl.width,
          height: updatedEl.height,
          rotation: updatedEl.rotation,
          fill: null,
          stroke: null,
          stroke_width: null,
          opacity: null,
          updated_at: updatedEl.updatedAt,
        }).catch(() => {});
      };

      const onSelectionCreated = (opt: { selected?: (FabricObject & { data?: Element })[] }) => {
        const sel = opt.selected?.[0];
        if (sel?.data?.id) selectElement(sel.data.id);
      };

      const onKeyDown = async (e: KeyboardEvent) => {
        if (e.key !== "Delete" && e.key !== "Backspace") return;
        const active = fc.getActiveObject() as (FabricObject & { data?: Element }) | null;
        if (!active?.data?.id) return;
        // Don't intercept when typing in a text element
        if (active.type === "i-text" && (active as IText).isEditing) return;
        fc.remove(active);
        fc.renderAll();
        removeElement(active.data.id);
        await rpcCall(contextId, "delete_element", { id: active.data.id }).catch(() => {});
      };

      fc.on("mouse:down", onMouseDown as (e: unknown) => void);
      fc.on("mouse:up", onMouseUp as (e: unknown) => void);
      fc.on("object:modified", onObjectModified as (e: unknown) => void);
      fc.on("selection:created", onSelectionCreated as (e: unknown) => void);
      fc.on("selection:updated", onSelectionCreated as (e: unknown) => void);
      fc.on("selection:cleared", () => selectElement(null));
      window.addEventListener("keydown", onKeyDown);

      return () => {
        fc.off("mouse:down");
        fc.off("mouse:up");
        fc.off("object:modified");
        fc.off("selection:created");
        fc.off("selection:updated");
        fc.off("selection:cleared");
        window.removeEventListener("keydown", onKeyDown);
      };
    }, [activeTool, contextId, elements.length, selectElement, upsertElement, removeElement]);

    // Expose cacheImage for parent (image upload flow)
    useEffect(() => {
      (canvasElRef.current as (HTMLCanvasElement & { _cacheImage?: typeof cacheImage }) | null)!._cacheImage = cacheImage;
    }, [cacheImage]);

    return (
      <div className={styles.wrap}>
        <canvas ref={canvasElRef} data-testid="fabric-canvas" />
      </div>
    );
  },
);

FabricCanvas.displayName = "FabricCanvas";
export default FabricCanvas;

function buildFabricObject(el: Element): FabricObject | null {
  const base = {
    left: el.x,
    top: el.y,
    width: el.width,
    height: el.height,
    angle: el.rotation,
    fill: el.fill || "transparent",
    stroke: el.stroke || "transparent",
    strokeWidth: el.strokeWidth,
    opacity: el.opacity / 100,
    data: el,
  };

  switch (el.data.kind) {
    case "Rect":
      return new Rect(base);
    case "Circle":
      return new Circle({ ...base, radius: el.width / 2 });
    case "Line":
      return new Line([el.x, el.y, el.x + el.width, el.y + el.height], {
        stroke: el.stroke || "#000",
        strokeWidth: el.strokeWidth,
        data: el,
      });
    case "Arrow":
      return new Line([el.x, el.y, el.x + el.width, el.y + el.height], {
        stroke: el.stroke || "#000",
        strokeWidth: el.strokeWidth,
        data: el,
      });
    case "Text":
      return new IText(el.data.content ?? "Text", {
        left: el.x,
        top: el.y,
        fontSize: el.data.fontSize ?? 16,
        fontFamily: el.data.fontFamily ?? "sans-serif",
        fill: el.fill || "#111",
        fontWeight: el.data.bold ? "bold" : "normal",
        fontStyle: el.data.italic ? "italic" : "normal",
        data: el,
      });
    case "Path":
      return new Path(el.data.points ?? "", {
        ...base,
        fill: "transparent",
      });
    default:
      return null;
  }
}
