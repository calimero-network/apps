import { useCallback, useRef } from "react";
import { v4 as uuid } from "uuid";
import { rpcCall } from "../api/rpc";
import { useCanvasStore } from "../store/canvasStore";
import { useToast } from "../contexts/ToastContext";
import { createMutationReporter } from "../utils/mutationErrors";
import {
  groupElements,
  groupPathOf,
  labelFor,
  siblingGroupNames,
  ungroupPath,
  uniqueGroupName,
} from "../utils/groups";
import { applyLabelPatch } from "../utils/groupOps";
import type { Element } from "../types";

/**
 * Group / ungroup / frame, shared by the layers panel and the canvas shortcuts
 * (⌘G, ⇧⌘G) so both do exactly the same thing to contract state.
 */
export function useGroupActions(contextId: string, readOnly = false) {
  const { showToast } = useToast();
  const report = useRef(createMutationReporter((m) => showToast(m, "error")));
  report.current = createMutationReporter((m) => showToast(m, "error"));

  const deps = useCallback(
    () => ({
      contextId,
      applyLabels: useCanvasStore.getState().setElementLabels,
      onError: (method: string, error: unknown) => report.current(method, error),
    }),
    [contextId],
  );

  /** Elements currently selected, read fresh so a stale render cannot group the
   *  wrong set. */
  const selection = useCallback((): Element[] => {
    const { elements, selectedElementIds } = useCanvasStore.getState();
    const ids = new Set(selectedElementIds);
    return elements.filter((e) => ids.has(e.id));
  }, []);

  const groupSelection = useCallback(async () => {
    if (readOnly) return;
    const selected = selection();
    if (selected.length < 2) {
      showToast("Select two or more layers to group them", "info");
      return;
    }
    const { elements, selectedElementIds } = useCanvasStore.getState();
    const name = uniqueGroupName(siblingGroupNames(elements, ""), "Group");
    const patch = groupElements(elements, selectedElementIds, name);
    await applyLabelPatch(patch, deps());
    showToast(`Grouped ${Object.keys(patch).length} layers into “${name}”`, "success");
    return name;
  }, [deps, readOnly, selection, showToast]);

  const ungroupSelection = useCallback(async () => {
    if (readOnly) return;
    const selected = selection();
    const paths = new Set(selected.map((e) => groupPathOf(e.label)).filter(Boolean));
    if (paths.size === 0) {
      showToast("The selection is not in a group", "info");
      return;
    }
    let moved = 0;
    for (const path of paths) {
      const { elements } = useCanvasStore.getState();
      const patch = ungroupPath(elements, path);
      moved += Object.keys(patch).length;
      await applyLabelPatch(patch, deps());
    }
    showToast(`Ungrouped ${moved} layers`, "info");
  }, [deps, readOnly, selection, showToast]);

  /**
   * A frame: the same grouping, plus a backdrop rect behind the members so the
   * region is visible, selectable and exportable as a unit.
   */
  const frameSelection = useCallback(async () => {
    if (readOnly) return;
    const selected = selection();
    if (selected.length === 0) {
      showToast("Select something to frame", "info");
      return;
    }
    const store = useCanvasStore.getState();
    const name = uniqueGroupName(siblingGroupNames(store.elements, ""), "Frame");
    const pad = 16;
    const minX = Math.min(...selected.map((e) => e.x));
    const minY = Math.min(...selected.map((e) => e.y));
    const maxX = Math.max(...selected.map((e) => e.x + e.width));
    const maxY = Math.max(...selected.map((e) => e.y + e.height));
    const backdrop: Element = {
      id: uuid(),
      data: { kind: "rect" },
      x: Math.round(minX - pad), y: Math.round(minY - pad),
      width: Math.round(maxX - minX + pad * 2), height: Math.round(maxY - minY + pad * 2),
      rotation: 0, fill: "#ffffff", stroke: "#e2e2e6", strokeWidth: 1, opacity: 100,
      // One below the frame's back-most member, so the backdrop never covers it.
      layerIndex: Math.max(0, Math.min(...selected.map((e) => e.layerIndex)) - 1),
      createdBy: "", createdAt: Date.now(), updatedAt: Date.now(),
      cornerRadius: 8,
      label: labelFor(name, "Background"),
    };
    store.snapshot();
    store.upsertElement(backdrop);
    await rpcCall(contextId, "add_element", { element: backdrop })
      .catch((e) => report.current("add_element", e));

    const next = useCanvasStore.getState();
    const patch = groupElements(next.elements, [...next.selectedElementIds, backdrop.id], name);
    await applyLabelPatch(patch, deps());
    showToast(`Framed ${selected.length} layers as “${name}”`, "success");
    return name;
  }, [contextId, deps, readOnly, selection, showToast]);

  return { groupSelection, ungroupSelection, frameSelection };
}
