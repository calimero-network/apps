export const UNTITLED_DOC_LABEL = 'Untitled'; // a blank title is never shown blank

/** A doc's display title, or a plain fallback while it has none. */
export function docLabel(title?: string | null): string {
  return title?.trim() || UNTITLED_DOC_LABEL;
}
