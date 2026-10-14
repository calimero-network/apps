import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import type { Attachment } from "./generated/HyperfeedClient";
import { IMAGE_TYPES, MAX_ATTACHMENTS, refuseImage, uploadImage, type BlobStore } from "./attachments";

/** An image picked for the next message, with its local preview. */
interface Picked {
  file: File;
  preview: string;
}

/**
 * The images on a message you are writing, picked, pasted or dropped: Chat's
 * composer and the feed's ask boxes take them the same way. Without a store,
 * nothing is taken and the box takes text only.
 */
export interface ImagePicker {
  images: BlobStore | null;
  picked: Picked[];
  refused: string | null;
  uploading: boolean;
  add: (files: Iterable<File>) => void;
  remove: (p: Picked) => void;
  /** Uploads what was picked: the attachments, or null when an upload failed (and says why). */
  upload: () => Promise<Attachment[] | null>;
  /** After the message went: the picks are gone. */
  clear: () => void;
  /** Pasted images join the message; pasted text is left to the box. */
  onPaste: (e: ClipboardEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

export function useImagePicker(images: BlobStore | null): ImagePicker {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [refused, setRefused] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  // The previews' object URLs go with the box.
  useEffect(() => () => pickedRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  const add = (files: Iterable<File>) => {
    if (!images) return;
    const next = [...picked];
    let why: string | null = null;
    for (const file of files) {
      const refusal = refuseImage(file, next.length);
      if (refusal) {
        why = refusal;
        continue;
      }
      next.push({ file, preview: URL.createObjectURL(file) });
    }
    setPicked(next);
    setRefused(why);
  };
  const remove = (p: Picked) => {
    URL.revokeObjectURL(p.preview);
    setPicked((all) => all.filter((x) => x !== p));
  };
  const upload = async () => {
    const attachments: Attachment[] = [];
    if (picked.length === 0 || !images) return attachments;
    setUploading(true);
    try {
      for (const p of picked) attachments.push(await uploadImage(images, p.file));
      return attachments;
    } catch (e) {
      setRefused(`Couldn't upload the image: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      setUploading(false);
    }
  };
  const clear = () => {
    picked.forEach((p) => URL.revokeObjectURL(p.preview));
    setPicked([]);
    setRefused(null);
  };
  return {
    images,
    picked,
    refused,
    uploading,
    add,
    remove,
    upload,
    clear,
    onPaste: (e) => {
      const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
      if (!images || files.length === 0) return;
      e.preventDefault();
      add(files);
    },
    onDragOver: (e) => {
      if (images && e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    onDrop: (e) => {
      if (!images || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      add(Array.from(e.dataTransfer.files));
    },
  };
}

/** The picked images as thumbnails, each with Remove, and why one was refused. */
export function PickedImages({ picker }: { picker: ImagePicker }) {
  if (picker.picked.length === 0 && !picker.refused) return null;
  return (
    <div className="composer-attachments">
      {picker.picked.map((p) => (
        <span key={p.preview} className="composer-thumb">
          <img src={p.preview} alt={p.file.name || "Pasted image"} />
          <button type="button" className="composer-thumb-remove" aria-label={`Remove ${p.file.name || "image"}`} onClick={() => picker.remove(p)}>
            ×
          </button>
        </span>
      ))}
      {picker.refused && (
        <span className="composer-refused" role="alert">
          {picker.refused}
        </span>
      )}
    </div>
  );
}

/** 📎: picks images from your files. Nothing without a store. */
export function AttachButton({ picker, busy }: { picker: ImagePicker; busy: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  if (!picker.images) return null;
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        multiple
        hidden
        aria-label="Attach images"
        onChange={(e) => {
          picker.add(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="ghost composer-attach"
        aria-label="Attach images"
        title="Attach images (or paste, or drop them here)"
        disabled={busy || picker.uploading || picker.picked.length >= MAX_ATTACHMENTS}
        onClick={() => fileInput.current?.click()}
      >
        📎
      </button>
    </>
  );
}
