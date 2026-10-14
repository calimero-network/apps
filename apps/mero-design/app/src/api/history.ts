import { addElements, deleteElements, type OnBatchError } from "./elementBatch";
import { useCanvasStore } from "../store/canvasStore";
import { flushPendingWrites, type HistoryPlan } from "../store/history";

/**
 * Undo and redo on the board, not just in this tab.
 *
 * The store works out what the step changes and shows it at once; this writes
 * the same thing to the node so every member — and this tab's next sync — sees
 * it. Restored elements go out whole through `add_elements`, which replaces an
 * existing id and keeps its creator, so one call covers a move, a restyle, a
 * rename and a re-created delete alike.
 */
export async function undoOnBoard(contextId: string, onError: OnBatchError): Promise<void> {
  flushPendingWrites();
  await writePlan(contextId, useCanvasStore.getState().undo(), onError);
}

export async function redoOnBoard(contextId: string, onError: OnBatchError): Promise<void> {
  flushPendingWrites();
  await writePlan(contextId, useCanvasStore.getState().redo(), onError);
}

async function writePlan(contextId: string, p: HistoryPlan | null, onError: OnBatchError): Promise<void> {
  if (!p) return;
  if (p.upserts.length > 0) await addElements(contextId, p.upserts, onError);
  if (p.deletes.length > 0) {
    // Board size before the delete, as `deleteElements` sizes its chunks from it.
    const boardSize = useCanvasStore.getState().elements.length + p.deletes.length;
    await deleteElements(contextId, p.deletes, boardSize, onError);
  }
}
