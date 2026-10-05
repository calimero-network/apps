// Picked, pasted or dropped files become image blocks: each is checked, stored
// as a blob announced to the folder's docs context, then placed. A refused
// file is a toast and leaves the document alone.

import { useCallback } from 'react';
import { useMero } from '@calimero-network/mero-react';
import { classifyError } from '@calimero-network/mero-js';
import { toast } from 'sonner';
import type { DriveEditor } from '@/components/editor/blocknote/schema';
import { MAX_IMAGE_BYTES, blobRef, checkImageFile, parseBlobRef } from '@/lib/images';

export const IMAGE_TYPE_REFUSED = 'Only PNG, JPEG, GIF and WebP images can be added.';
export const IMAGE_SIZE_REFUSED = `Images can be up to ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`;
const UPLOAD_DENIED = "This session can't upload images.";
const UPLOAD_FAILED = 'Check your connection and try again.';

type Block = DriveEditor['document'][number];

/** Adds `files` as image blocks at `near`, the id of the block they were asked from. */
export type AddImages = (files: File[], near: string) => Promise<void>;

/** Puts `image` in place of an empty line at `near`, else after it, else at the end. */
function place(editor: DriveEditor, near: string, image: { name: string; url: string }): string {
  const block = { type: 'image' as const, props: image };
  const at: Block | undefined = editor.getBlock(near);
  if (!at) return editor.insertBlocks([block], editor.document[editor.document.length - 1], 'after')[0].id;
  const emptyLine = at.type === 'paragraph' && Array.isArray(at.content) && at.content.length === 0;
  return emptyLine ? editor.updateBlock(at, block).id : editor.insertBlocks([block], at, 'after')[0].id;
}

/** Moves the cursor to the line after `imageId`, adding one when the image ends the document. */
function resumeTypingAfter(editor: DriveEditor, imageId: string): void {
  const image = editor.getBlock(imageId);
  if (!image) return;
  const next =
    editor.getNextBlock(image) ?? editor.insertBlocks([{ type: 'paragraph' }], image, 'after')[0];
  editor.setTextCursorPosition(next, 'start');
}

export function useAddImages(editor: DriveEditor | null, contextId: string | null): AddImages {
  const { admin } = useMero();
  return useCallback(
    async (files, near) => {
      if (!editor) return;
      let anchor = near;
      let placed = false;
      for (const file of files) {
        const title = `Couldn't add ${file.name}`;
        const checked = await checkImageFile(file);
        if ('error' in checked) {
          const description = checked.error === 'type' ? IMAGE_TYPE_REFUSED : IMAGE_SIZE_REFUSED;
          toast.error(title, { description });
          continue;
        }
        const id = toast.loading(`Adding ${file.name}…`);
        try {
          if (!admin || !contextId) throw new Error('not connected to the folder yet');
          const { blobId } = await admin.uploadBlob({ data: file, contextId });
          const url = blobRef(blobId);
          if (!parseBlobRef(url)) throw new Error(`unusable blob id ${blobId}`);
          anchor = place(editor, anchor, { name: file.name, url });
          placed = true;
          toast.dismiss(id);
        } catch (cause) {
          console.warn('[images] upload failed', cause);
          const denied = classifyError(cause).kind === 'forbidden';
          toast.error(title, { id, description: denied ? UPLOAD_DENIED : UPLOAD_FAILED });
        }
      }
      if (placed) resumeTypingAfter(editor, anchor);
    },
    [editor, admin, contextId],
  );
}
