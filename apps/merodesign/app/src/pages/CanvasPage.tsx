import { useCallback, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { v4 as uuid } from "uuid";
import { rpcCall } from "../api/rpc";
import { useSse } from "../hooks/useSse";
import { useCanvasStore } from "../store/canvasStore";
import type { Element } from "../types";
import Toolbar from "../components/Toolbar";
import FabricCanvas, { type FabricCanvasHandle } from "../components/FabricCanvas";
import PropertiesPanel from "../components/PropertiesPanel";
import styles from "./CanvasPage.module.css";

export default function CanvasPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { setElements, upsertElement, removeElement, cacheImage, elements } = useCanvasStore();
  const canvasRef = useRef<FabricCanvasHandle>(null);

  useEffect(() => {
    if (!projectId) return;
    rpcCall<Element[]>(projectId, "get_elements", {})
      .then(setElements)
      .catch(() => setElements([]));
  }, [projectId, setElements]);

  const handleSseEvent = useCallback(
    (evt: MessageEvent) => {
      try {
        const payload = JSON.parse(evt.data as string);
        if (!projectId) return;
        if (payload.kind === "ElementAdded" || payload.kind === "ElementUpdated") {
          rpcCall<Element>(projectId, "get_element", { id: payload.element_id })
            .then((el) => { if (el) upsertElement(el); })
            .catch(() => {});
        } else if (payload.kind === "ElementDeleted") {
          removeElement(payload.element_id);
        } else if (payload.kind === "LayerReordered") {
          rpcCall<Element[]>(projectId, "get_elements", {})
            .then(setElements)
            .catch(() => {});
        }
      } catch {
        // ignore parse errors
      }
    },
    [projectId, upsertElement, removeElement, setElements],
  );

  useSse(projectId ?? null, handleSseEvent);

  async function handleImageUpload(
    _file: File,
    dataUrl: string,
    naturalWidth: number,
    naturalHeight: number,
  ) {
    if (!projectId) return;

    const maxW = 400;
    const scale = naturalWidth > maxW ? maxW / naturalWidth : 1;
    const w = Math.round(naturalWidth * scale);
    const h = Math.round(naturalHeight * scale);

    const el: Element = {
      id: uuid(),
      data: { kind: "Image", naturalWidth, naturalHeight },
      x: 40,
      y: 40,
      width: w,
      height: h,
      rotation: 0,
      fill: "transparent",
      stroke: "transparent",
      strokeWidth: 0,
      opacity: 100,
      layerIndex: elements.length,
      createdBy: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Cache the data URL so FabricCanvas can render it immediately
    cacheImage(el.id, dataUrl);
    upsertElement(el);

    await rpcCall(projectId, "add_element", { element: el }).catch(() => {});
  }

  return (
    <div className={styles.root}>
      <Toolbar
        contextId={projectId ?? ""}
        onExportPng={() => canvasRef.current?.exportPng()}
        onExportSvg={() => canvasRef.current?.exportSvg()}
        onImageUpload={handleImageUpload}
      />
      <div className={styles.workspace}>
        <FabricCanvas ref={canvasRef} contextId={projectId ?? ""} />
        <PropertiesPanel contextId={projectId ?? ""} />
      </div>
    </div>
  );
}
