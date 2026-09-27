export const UNTITLED_FOLDER_LABEL = 'Untitled folder'; // a folder id is never shown

/** A folder's display name, or a plain fallback while it has none. */
export function folderLabel(name?: string | null): string {
  return name?.trim() || UNTITLED_FOLDER_LABEL;
}
