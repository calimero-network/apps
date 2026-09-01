import { rpcCall } from "../api/rpc";
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

export async function exportProject(contextId: string): Promise<void> {
  const [elements, comments, board] = await Promise.all([
    rpcCall<Element[]>(contextId, "get_elements", {}),
    rpcCall<CanvasComment[]>(contextId, "get_comments", {}),
    rpcCall<{ name: string; description: string }>(contextId, "get_board", {}),
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
  await saveText(
    JSON.stringify(snapshot, null, 2),
    `${snapshot.boardName || "merodesign"}.merodesign`,
    "application/json",
  );
}

export async function importProject(
  contextId: string,
  snapshot: ProjectSnapshot,
): Promise<void> {
  await rpcCall(contextId, "clear_elements", {}).catch(() => {});
  await rpcCall(contextId, "clear_comments", {}).catch(() => {});

  if (snapshot.boardName) {
    await rpcCall(contextId, "update_board", {
      name: snapshot.boardName,
      description: snapshot.boardDescription ?? null,
    }).catch(() => {});
  }

  for (const el of snapshot.elements) {
    await rpcCall(contextId, "add_element", { element: el }).catch(() => {});
  }

  // On import, comment/reply authorship is re-attributed to the importer
  // (the signer) — author is no longer client-supplied.
  for (const comment of snapshot.comments) {
    await rpcCall(contextId, "add_comment", {
      id: comment.id,
      x: comment.x,
      y: comment.y,
      content: comment.content,
      created_at: comment.createdAt,
    }).catch(() => {});
    for (const reply of comment.replies ?? []) {
      await rpcCall(contextId, "add_reply", {
        comment_id: comment.id,
        reply_id: reply.id,
        content: reply.content,
        created_at: reply.createdAt,
      }).catch(() => {});
    }
  }
}
