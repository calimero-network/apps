import { beforeEach, describe, expect, it, vi } from "vitest";

const addElements = vi.fn(async () => {});
const deleteElements = vi.fn(async () => {});
vi.mock("./elementBatch", () => ({
  addElements: (...a: unknown[]) => addElements(...(a as [])),
  deleteElements: (...a: unknown[]) => deleteElements(...(a as [])),
}));

import { redoOnBoard, undoOnBoard } from "./history";
import { useCanvasStore } from "../store/canvasStore";
import { registerPendingWrite } from "../store/history";
import type { Element } from "../types";

const rect = (id: string, x = 0): Element => ({
  id, data: { kind: "rect" }, x, y: 0, width: 10, height: 10, rotation: 0,
  fill: "#fff", stroke: "#000", strokeWidth: 1, opacity: 100, layerIndex: 0,
  createdBy: "", createdAt: 0, updatedAt: 0,
});

describe("undo / redo on the board", () => {
  const onError = vi.fn();

  beforeEach(() => {
    addElements.mockClear();
    deleteElements.mockClear();
    useCanvasStore.setState({ elements: [], undoStack: [], redoStack: [], historyOpen: false, elementLabels: {} });
  });

  // The bug: undo only changed this tab's store, so the node — and every
  // teammate, and this tab's next sync — kept the edit.
  it("writes the undone move to the node", async () => {
    const s = useCanvasStore.getState();
    s.setElements([rect("a", 0)]);
    s.snapshot();
    s.upsertElement(rect("a", 50));
    await undoOnBoard("ctx", onError);
    expect(addElements).toHaveBeenCalledTimes(1);
    const [ctx, written] = addElements.mock.calls[0] as unknown as [string, Element[]];
    expect(ctx).toBe("ctx");
    expect(written.map((e) => [e.id, e.x])).toEqual([["a", 0]]);
    expect(deleteElements).not.toHaveBeenCalled();
  });

  it("deletes an undone create from the node, and redo writes it back", async () => {
    const s = useCanvasStore.getState();
    s.snapshot();
    s.upsertElement(rect("b"));
    await undoOnBoard("ctx", onError);
    expect(deleteElements).toHaveBeenCalledWith("ctx", ["b"], 1, onError);
    await redoOnBoard("ctx", onError);
    const [, written] = addElements.mock.calls[0] as unknown as [string, Element[]];
    expect(written.map((e) => e.id)).toEqual(["b"]);
  });

  it("sends a held inspector write before the undo, so the undo lands last", async () => {
    const order: string[] = [];
    const unregister = registerPendingWrite(() => order.push("held"));
    addElements.mockImplementationOnce(async () => { order.push("undo"); });
    const s = useCanvasStore.getState();
    s.setElements([rect("a", 0)]);
    s.snapshot();
    s.upsertElement(rect("a", 50));
    await undoOnBoard("ctx", onError);
    unregister();
    expect(order).toEqual(["held", "undo"]);
  });

  it("writes nothing when there is nothing to undo", async () => {
    await undoOnBoard("ctx", onError);
    expect(addElements).not.toHaveBeenCalled();
    expect(deleteElements).not.toHaveBeenCalled();
  });
});
