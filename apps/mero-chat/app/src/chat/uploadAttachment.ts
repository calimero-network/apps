import { getContextId } from "@calimero-network/mero-react";
import { uploadBlobDirect } from "../api/dataSource/groupApiDataSource";
import type { ChatFile, FileObject } from "../types/Common";

/**
 * Upload one composer attachment and describe it the way the composer holds it.
 *
 * Shared by the upload popup and drag-and-drop onto the composer, so both
 * reach the node the same way. Throws with a user-facing message; the caller
 * owns the toast. The returned `previewUrl` is the caller's to revoke.
 */
export async function uploadChatAttachment(file: globalThis.File): Promise<ChatFile> {
  // No context, no upload. A blob announced to nobody is stored on this node
  // and invisible to every other member of the channel, and it looks like it
  // worked because our own node has the bytes. This is the last point where
  // the user can still be told.
  const contextId = getContextId();
  if (!contextId) {
    throw new Error(
      "Open a channel before attaching a file — an attachment is stored against the conversation it belongs to.",
    );
  }

  const res = await uploadBlobDirect(file, contextId);
  if (res.error || !res.data?.blobId) {
    throw new Error(res.error?.message || "Failed to upload attachment");
  }

  const fileObject: FileObject = {
    blobId: res.data.blobId,
    name: file.name,
    size: file.size,
    type: file.type,
    uploadedAt: Date.now(),
  };
  return { file: fileObject, previewUrl: URL.createObjectURL(file) };
}
