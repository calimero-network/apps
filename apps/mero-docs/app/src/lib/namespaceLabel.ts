/** A namespace's display name, or a short id while its name is unknown. */
export function namespaceLabel(
  namespaceId: string,
  name?: string | null,
): string {
  return name ?? namespaceId.slice(0, 8);
}
