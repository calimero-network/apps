export const UNTITLED_WORKSPACE_LABEL = 'Untitled workspace'; // a workspace id is never shown

/** A namespace's display name, or a plain fallback while it has none. */
export function namespaceLabel(name?: string | null): string {
  return name?.trim() || UNTITLED_WORKSPACE_LABEL;
}
