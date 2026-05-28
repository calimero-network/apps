import { useEffect, useRef } from "react";
import { Canvas, Rect, Circle, Line, IText, FabricImage, Path } from "fabric";
import { v4 as uuid } from "uuid";
import { rpcCall } from "../api/rpc";
import { useCanvasStore } from "../store/canvasStore";
import type { Element } from "../types";
import styles from "./FabricCanvas.module.css";

interface Props {
  contextId: string;
}

export default function FabricCanvas({ contextId }: Props) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const { activeTool, elements, selectElement, upsertElement } = useCanvasStore();

  // Init Fabric canvas
  useEffect(() => {
    if (!canvasElRef.current) return;

    const fc = new Canvas(canvasElRef.current, {
      width: window.innerWidth - 220,
      height: window.innerHeight - 48,
      backgroundColor: "#f0f0f0",
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

  // Sync elements from store → canvas
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    fc.clear();
    for (const el of [...elements].sort((a, b) => a.layerIndex - b.layerIndex)) {
      const obj = buildFabricObject(el);
      if (obj) fc.add(obj);
    }
    fc.renderAll();
  }, [elements]);

  // Tool-aware mouse handler
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    fc.isDrawingMode = activeTool === "path";

    let startX = 0;
    let startY = 0;
    let drawing = false;

    const onMouseDown = (opt: { e: MouseEvent }) => {
      if (activeTool === "select" || activeTool === "path") return;
      const pointer = fc.getScenePoint(opt.e);
      startX = pointer.x;
      startY = pointer.y;
      drawing = true;
    };

    const onMouseUp = async (opt: { e: MouseEvent }) => {
      if (!drawing || activeTool === "select" || activeTool === "path") return;
      drawing = false;
      const pointer = fc.getScenePoint(opt.e);
      const w = Math.abs(pointer.x - startX) || 100;
      const h = Math.abs(pointer.y - startY) || 60;
      const x = Math.min(pointer.x, startX);
      const y = Math.min(pointer.y, startY);

      const el: Element = {
        id: uuid(),
        data: { kind: activeTool === "circle" ? "Circle"
               : activeTool === "line" ? "Line"
               : activeTool === "arrow" ? "Arrow"
               : activeTool === "text" ? "Text"
               : "Rect" },
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

    const onSelectionCreated = (opt: { selected?: { data?: Element }[] }) => {
      const sel = opt.selected?.[0];
      if (sel?.data?.id) selectElement(sel.data.id);
    };

    fc.on("mouse:down", onMouseDown as (e: unknown) => void);
    fc.on("mouse:up", onMouseUp as (e: unknown) => void);
    fc.on("selection:created", onSelectionCreated as (e: unknown) => void);
    fc.on("selection:cleared", () => selectElement(null));

    return () => {
      fc.off("mouse:down");
      fc.off("mouse:up");
      fc.off("selection:created");
      fc.off("selection:cleared");
    };
  }, [activeTool, contextId, elements.length, selectElement, upsertElement]);

  return (
    <div className={styles.wrap}>
      <canvas ref={canvasElRef} />
    </div>
  );
}

function buildFabricObject(el: Element) {
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
    case "Rect": return new Rect(base);
    case "Circle": return new Circle({ ...base, radius: el.width / 2 });
    case "Line":
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
        fill: el.fill || "#111",
        data: el,
      });
    case "Path":
      return new Path(el.data.points ?? "", {
        ...base,
        fill: "transparent",
      });
    default: return null;
  }
}
