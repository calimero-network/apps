/**
 * What the editor reads again for one of the document's events: only the part
 * the event changed, so a burst of layer edits re-reads the layers once and
 * nothing else. A reconnect reads all of it ({@link ALL_READS}).
 */
export type Read = "document" | "layers" | "members" | "role";

export const ALL_READS: readonly Read[] = ["document", "layers", "members", "role"];

export function readsFor(kind: string, data: unknown, self: string): Read[] {
  switch (kind) {
    case "LayerAdded":
    case "LayerUpdated":
    case "LayerDeleted":
    case "LayersReordered":
      return ["layers"];
    case "MemberJoined":
    case "MemberUsernameUpdated":
      return ["members"];
    case "DocumentUpdated":
      return ["document"];
    case "RoleUpdated":
      return (data as { member?: unknown } | null)?.member === self ? ["role"] : [];
    case "OwnerTransferred":
      return ["role"];
    // Cursors travel over presence; an older build's `CursorMoved` changes nothing shown.
    default:
      return [];
  }
}

/** Whether `error` (or its `cause`) says this account can no longer read the document: `403` or `404`. */
export function lostAccess(error: unknown): boolean {
  for (let e = error, depth = 0; e && typeof e === "object" && depth < 4; depth++) {
    const status = (e as { status?: unknown }).status;
    if (status === 403 || status === 404) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
