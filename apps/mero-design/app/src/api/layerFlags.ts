import { updateElementLabels, type OnBatchError } from "./elementBatch";
import { useCanvasStore } from "../store/canvasStore";
import { toggleFlag, type LayerFlag } from "../utils/layerFlags";

/**
 * Lock/unlock or hide/show the elements named by `ids`, for everyone.
 *
 * The flags live in the label, so they are saved with `update_element_labels`.
 * The store is written first: the label packer reads each element's extras from
 * the store (`api/rpc.ts`), which is how the new flag gets into the label.
 * Recorded as one undo step.
 *
 * Returns the value applied, or `null` when nothing changed.
 */
export async function toggleLayerFlag(
  contextId: string,
  ids: readonly string[],
  flag: LayerFlag,
  onError: OnBatchError,
): Promise<boolean | null> {
  const store = useCanvasStore.getState();
  const now = Date.now();
  const { value, changed } = toggleFlag(store.elements, ids, flag, now);
  if (changed.length === 0) return null;
  store.snapshot();
  store.upsertElements(changed);
  const labels = Object.fromEntries(changed.map((el) => [el.id, el.label ?? null]));
  await updateElementLabels(contextId, labels, now, onError);
  return value;
}
