import { design, i64, readElements } from "../api/rpc";
import { addElements, deleteElements } from "../api/elementBatch";
import { saveText } from "./saveFile";
import type { CanvasComment, Element } from "../types";

export interface ProjectSnapshot {
  version: 1;
  exportedAt: number;
  boardName: string;
  boardDescription: string;
  elements: Element[];
  comments: CanvasComment[];
}

export function validateSnapshot(data: unknown): data is ProjectSnapshot {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (d.version !== 1) return false;
  if (!Array.isArray(d.elements)) return false;
  if (!Array.isArray(d.comments)) return false;
  return true;
}

/** Writes the board to a `.merodesign` file. Resolves the filename, or null if the user cancelled. */
export async function exportProject(contextId: string): Promise<string | null> {
  const [elements, comments, board] = await Promise.all([
    readElements(design(contextId)),
    (design(contextId).getComments() as Promise<CanvasComment[]>),
    (design(contextId).getBoard() as Promise<{ name: string; description: string }>),
  ]);

  const snapshot: ProjectSnapshot = {
    version: 1,
    exportedAt: Date.now(),
    boardName: board?.name ?? "",
    boardDescription: board?.description ?? "",
    elements: Array.isArray(elements) ? elements : [],
    comments: Array.isArray(comments) ? comments : [],
  };

  // Goes through the shared save seam: this used to build its own anchor, which
  // the Tauri webview ignores (item 9).
  const filename = `${snapshot.boardName || "mero-design"}.merodesign`;
  const saved = await saveText(JSON.stringify(snapshot, null, 2), filename, "application/json");
  return saved ? filename : null;
}

export async function importProject(
  contextId: string,
  snapshot: ProjectSnapshot,
): Promise<void> {
  // Replace the board's elements with the snapshot's. `clear_elements` did this
  // in one call and ran out of gas on any board past ~130 elements — the import
  // then drew the file on top of the old board. Now: delete only what the file
  // does not have, in batches sized to the board, and write the rest over the
  // top (an `add_elements` with an existing id overwrites it in place).
  const existing = await readElements(design(contextId)).catch(() => null);
  const current = Array.isArray(existing) ? existing : [];
  const keep = new Set(snapshot.elements.map((el) => el.id));
  const stale = current.map((el) => el.id).filter((id) => !keep.has(id));
  await deleteElements(contextId, stale, current.length, () => {});
  await design(contextId).clearComments().catch(() => {});

  if (snapshot.boardName) {
    await design(contextId).updateBoard({
      name: snapshot.boardName,
      description: snapshot.boardDescription ?? null,
    }).catch(() => {});
  }

  await addElements(contextId, snapshot.elements, () => {});

  // On import, comment/reply authorship is re-attributed to the importer
  // (the signer) — author is no longer client-supplied.
  for (const comment of snapshot.comments) {
    await design(contextId).addComment({
      id: comment.id,
      x: i64(comment.x),
      y: i64(comment.y),
      content: comment.content,
      createdAt: i64(comment.createdAt),
    }).catch(() => {});
    for (const reply of comment.replies ?? []) {
      await design(contextId).addReply({
        commentId: comment.id,
        replyId: reply.id,
        content: reply.content,
        createdAt: i64(reply.createdAt),
      }).catch(() => {});
    }
  }
}
