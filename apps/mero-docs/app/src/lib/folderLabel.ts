export const UNTITLED_FOLDER_LABEL = 'Untitled folder'; // a folder id is never shown

/** A folder's display name, or a plain fallback while it has none. */
export function folderLabel(name?: string | null): string {
  return name?.trim() || UNTITLED_FOLDER_LABEL;
}

/** The display names of the folders `ids`, joined for a message. */
export function folderNames(
  folders: readonly { id: string; alias?: string | null }[],
  ids: readonly string[],
): string {
  return ids
    .map((id) => folderLabel(folders.find((f) => f.id === id)?.alias))
    .join(', ');
}
