import { useCallback, useRef } from "react";
import { v4 as uuid } from "uuid";
import { rpcCall } from "../api/rpc";
import { useCanvasStore } from "../store/canvasStore";
import { useToast } from "../contexts/ToastContext";
import { createMutationReporter } from "../utils/mutationErrors";
import { applyLabelPatch } from "../utils/groupOps";
import { boundsOf } from "../utils/svgExport";
import { nameOf } from "../utils/groups";
import {
  cleanScreenName,
  isScreen,
  listScreens,
  nextScreenName,
  screenLabel,
} from "../utils/screens";
import type { Element } from "../types";

/** Breathing room between a new screen's edge and the layers it was made from. */
export const SCREEN_PADDING = 40;

/**
 * Create / rename / unmark screens. Every change is a label write or one new
 * rect, through contract methods the board already has — see `screens.ts`.
 */
export function useScreenActions(contextId: string, readOnly = false) {
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

  /**
   * Turns the selection into a screen.
   *
   * One plain rect selected → that rect becomes the screen, the way "frame
   * selection" on a single shape works. Anything else → a new backdrop sized to
   * the selection, placed behind it. The selected layers keep their own labels
   * and groups: a screen is its area, so they are on it by being inside it.
   */
  const createScreen = useCallback(async (): Promise<string | undefined> => {
    if (readOnly) return;
    const store = useCanvasStore.getState();
    const ids = new Set(store.selectedElementIds);
    const selected = store.elements.filter((e) => ids.has(e.id));
    if (selected.length === 0) {
      showToast("Select the layers that should make up the screen", "info");
      return;
    }
    const screens = listScreens(store.elements, store.elementLabels);
    const name = nextScreenName(screens);

    const [only] = selected;
    if (selected.length === 1 && only.data.kind === "rect") {
      if (isScreen(only, store.elementLabels[only.id])) {
        showToast("That is already a screen", "info");
        return only.id;
      }
      // A rect somebody already named keeps its name as the screen's.
      const own = only.label ? nameOf(only) : "";
      const screenName = cleanScreenName(own, name);
      await applyLabelPatch({ [only.id]: screenLabel(screenName) }, deps());
      showToast(`“${screenName}” is now a screen`, "success");
      return only.id;
    }

    const box = boundsOf(selected, SCREEN_PADDING);
    const back = Math.min(...selected.map((e) => e.layerIndex));
    const now = Date.now();
    const backdrop: Element = {
      id: uuid(),
      data: { kind: "rect" },
      x: box.x, y: box.y, width: box.width, height: box.height,
      rotation: 0,
      // The board's own colour, so the slide looks like the canvas it came from.
      fill: store.background, stroke: "transparent", strokeWidth: 0, opacity: 100,
      // Directly behind the back-most selected layer. At the very bottom there is
      // no slot below it, so the contract's send_to_back makes one (below).
      layerIndex: Math.max(0, back - 1),
      createdBy: "", createdAt: now, updatedAt: now,
      label: screenLabel(name),
    };

    store.snapshot();
    store.upsertElement(backdrop);
    await rpcCall(contextId, "add_element", { element: backdrop })
      .catch((e) => report.current("add_element", e));
    if (back === 0) {
      // Every other layer moves up one — mirror what the contract does, so the
      // backdrop is not painted over the very layers it was made for.
      useCanvasStore.getState().setElements(
        useCanvasStore.getState().elements.map((e) =>
          e.id === backdrop.id ? { ...e, layerIndex: 0 } : { ...e, layerIndex: e.layerIndex + 1 },
        ),
      );
      await rpcCall(contextId, "send_to_back", { id: backdrop.id })
        .catch((e) => report.current("send_to_back", e));
    }
    useCanvasStore.getState().selectElement(backdrop.id);
    showToast(`Created “${name}” from ${selected.length} layer${selected.length === 1 ? "" : "s"}`, "success");
    return backdrop.id;
  }, [contextId, deps, readOnly, showToast]);

  const renameScreen = useCallback(async (id: string, name: string) => {
    if (readOnly) return;
    const clean = cleanScreenName(name, "");
    if (!clean) return;
    await applyLabelPatch({ [id]: screenLabel(clean) }, deps());
  }, [deps, readOnly]);

  /** Stops presenting a screen. The rect stays on the board as a plain layer. */
  const unmarkScreen = useCallback(async (id: string) => {
    if (readOnly) return;
    const store = useCanvasStore.getState();
    const el = store.elements.find((e) => e.id === id);
    if (!el) return;
    const label = store.elementLabels[id] ?? el.label ?? "";
    const name = label.split("/").pop()?.trim() || "rect";
    await applyLabelPatch({ [id]: name }, deps());
    showToast(`“${name}” is no longer a screen`, "info");
  }, [deps, readOnly, showToast]);

  return { createScreen, renameScreen, unmarkScreen };
}
