/**
 * What one SSE `StateMutation` asks the canvas to re-read.
 *
 * The node sends `{ newRoot, events: [{ kind, data: u8[] }] }`, where `data` is
 * the contract-emitted payload as JSON bytes. This used to be handled event by
 * event — one `get_element` per `ElementAdded` — so a paste of 3000 shapes came
 * back as 3000 more reads, on every peer AND as the author's own echo. Folding
 * a mutation into one plan first means a batch costs one `get_elements_by_ids`
 * pass and one store update, however it was emitted: one `ElementsAdded` with
 * every id, or (from an older bundle) many `ElementAdded`s in one mutation.
 */
export interface BoardChanges {
  /** Elements to re-read — added or updated, and not deleted in the same mutation. */
  fetch: string[];
  /** Elements to drop locally. */
  remove: string[];
  /** Layer order changed: re-read the whole list. */
  layers: boolean;
  comments: boolean;
  removedComments: string[];
  cursors: boolean;
  members: boolean;
  /** A role or ownership change — our own may have flipped. */
  role: boolean;
}

interface RawEvent {
  kind?: string;
  data?: number[];
}

function decode(data: number[] | undefined): unknown {
  if (!Array.isArray(data) || data.length === 0) return null;
  try {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data)));
  } catch {
    return null;
  }
}

function idsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

export function collectBoardChanges(raw: unknown): BoardChanges {
  const out: BoardChanges = {
    fetch: [], remove: [], layers: false, comments: false,
    removedComments: [], cursors: false, members: false, role: false,
  };
  if (typeof raw !== "object" || raw === null) return out;
  const events = (raw as { events?: RawEvent[] }).events;
  if (!Array.isArray(events)) return out;

  const fetch = new Set<string>();
  const remove = new Set<string>();
  for (const ev of events) {
    const value = decode(ev.data);
    switch (ev.kind ?? "") {
      case "ElementAdded":
      case "ElementUpdated":
      case "ElementsAdded":
      case "ElementsUpdated":
        for (const id of idsOf(value)) { fetch.add(id); remove.delete(id); }
        break;
      case "ElementDeleted":
      case "ElementsDeleted":
        for (const id of idsOf(value)) { remove.add(id); fetch.delete(id); }
        break;
      case "LayerReordered": out.layers = true; break;
      case "CommentAdded":
      case "CommentUpdated": out.comments = true; break;
      case "CommentDeleted": out.removedComments.push(...idsOf(value)); break;
      case "CursorMoved": out.cursors = true; break;
      case "MemberJoined":
      case "MemberUsernameUpdated": out.members = true; break;
      case "RoleUpdated":
      case "OwnerTransferred": out.role = true; out.members = true; break;
      default: break;
    }
  }
  out.fetch = [...fetch];
  out.remove = [...remove];
  return out;
}
