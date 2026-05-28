import { useCallback, useEffect } from "react";
import { useParams } from "react-router-dom";
import { rpcCall } from "../api/rpc";
import { useSse } from "../hooks/useSse";
import { useCanvasStore } from "../store/canvasStore";
import type { Element } from "../types";
import Toolbar from "../components/Toolbar";
import FabricCanvas from "../components/FabricCanvas";
import PropertiesPanel from "../components/PropertiesPanel";
import styles from "./CanvasPage.module.css";

export default function CanvasPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { setElements, upsertElement, removeElement } = useCanvasStore();

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

  return (
    <div className={styles.root}>
      <Toolbar contextId={projectId ?? ""} />
      <div className={styles.workspace}>
        <FabricCanvas contextId={projectId ?? ""} />
        <PropertiesPanel contextId={projectId ?? ""} />
      </div>
    </div>
  );
}
