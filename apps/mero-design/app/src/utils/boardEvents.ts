/**
 * What a batch of the board's events asks the canvas to re-read.
 *
 * `hooks/useSse` hands over `{ events: [{ kind, data }] }`, where `data` is the
 * contract's event payload (`{ id }`, `{ ids }`, `{ member }`, …); v1's node
 * sent it as JSON bytes, which are still read. This used to be handled event by
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
  data?: unknown;
}

/** An event's payload: the value itself, or (v1) its JSON as bytes. */
function decode(data: unknown): unknown {
  if (Array.isArray(data) && data.length > 0 && data.every((b) => typeof b === "number")) {
    try {
      return JSON.parse(new TextDecoder().decode(new Uint8Array(data as number[])));
    } catch {
      return null;
    }
  }
  return data ?? null;
}

function idsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (value && typeof value === "object") {
    const o = value as { id?: unknown; ids?: unknown };
    if (o.ids !== undefined) return idsOf(o.ids);
    if (o.id !== undefined) return idsOf(o.id);
  }
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
