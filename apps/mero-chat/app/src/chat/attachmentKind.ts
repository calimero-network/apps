// Which composer slot a file belongs in: the image slot (rendered inline as a
// picture) or the file slot (rendered as a download card).
//
// The "Upload Image" picker and a drop onto the composer must agree, or the
// same PNG would render as a picture one way and a download card the other.
// So the image list lives here and the picker's `accept` reads it too.

export type AttachmentKind = "image" | "file";

/** What the image slot takes. Everything else is a file attachment. */
export const IMAGE_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
] as const;

// A dropped file's `type` is whatever the OS guessed, and it is sometimes
// empty (files dragged out of some archive viewers and Linux file managers).
// The extension is the fallback, never the first word.
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif"];

export function attachmentKindFor(file: { name: string; type: string }): AttachmentKind {
  const type = file.type.toLowerCase();
  if (type) {
    return (IMAGE_ATTACHMENT_TYPES as readonly string[]).includes(type)
      ? "image"
      : "file";
  }
  const name = file.name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext)) ? "image" : "file";
}

/**
 * Only drags that carry files. Dragging selected text or a link over the
 * composer must keep the editor's own drop behaviour.
 */
export function dragCarriesFiles(dataTransfer: DataTransfer | null): boolean {
  return Array.from(dataTransfer?.types ?? []).includes("Files");
}
