import { uploadBlob } from "../api/blobs";
import { getActiveApp } from "../calimero/connection";
import type { ChatFile, FileObject } from "../types/Common";

/**
 * Upload one composer attachment to the open conversation and describe it the
 * way the composer holds it. Shared by the upload popup and drag-and-drop onto
 * the composer. Throws with a user-facing message; the caller owns the toast.
 * The returned `previewUrl` is the caller's to revoke.
 */
export async function uploadChatAttachment(file: globalThis.File): Promise<ChatFile> {
  const app = getActiveApp();
  if (!app) {
    throw new Error(
      "Open a channel before attaching a file — an attachment is stored against the conversation it belongs to.",
    );
  }
  const res = await uploadBlob(file, app);
  const fileObject: FileObject = {
    blobId: res.blobId,
    name: file.name,
    size: file.size,
    type: file.type,
    uploadedAt: Date.now(),
  };
  return { file: fileObject, previewUrl: URL.createObjectURL(file) };
}
