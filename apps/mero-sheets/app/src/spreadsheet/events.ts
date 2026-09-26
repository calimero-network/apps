/**
 * What to re-read after a node event, instead of the whole workbook.
 *
 * Every event used to trigger a full refresh: the sheet list, every cell of
 * every sheet (recomputed on the node), the roster, the project and `whoami`.
 * The contract's events already say what changed, so a cell write re-reads
 * that sheet, a rename re-reads the sheet list, and a new member re-reads the
 * roster. Anything this cannot account for falls back to a full refresh.
 */

/** A decided plan: either everything, or exactly these parts. */
export type RefreshPlan =
  | { full: true }
  | { full: false; sheets: Set<string>; sheetList: boolean; members: boolean; layouts: boolean; names: boolean; comments: boolean; notes: boolean; protections: boolean; views: boolean; styles: boolean; rules: boolean; charts: boolean };

const empty = (): Extract<RefreshPlan, { full: false }> => ({
  full: false,
  sheets: new Set(),
  sheetList: false,
  members: false,
  layouts: false,
  names: false,
  comments: false,
  notes: false,
  protections: false,
  views: false,
  styles: false,
  rules: false,
  charts: false,
});

const FULL: RefreshPlan = { full: true };

/** A node event as the subscription delivers it: `{ contextId, type, data }`. */
interface NodeEvent {
  type?: string;
  data?: unknown;
}

interface ExecutionEvent {
  kind?: unknown;
  data?: unknown;
}

/** An app event's payload: JSON, carried as a byte array. */
function payload(e: ExecutionEvent): Record<string, unknown> | null {
  if (!Array.isArray(e.data)) return null;
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(e.data as number[])));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The plan for one event, or `null` when it changes nothing this hook shows:
 * presence frames, sync-status updates and cross-context call reports.
 */
export function planFor(event: NodeEvent): RefreshPlan | null {
  switch (event.type) {
    case 'Ephemeral':
    case 'SyncStatus':
    case 'XCall':
      return null;
    case 'StateMutation':
      break;
    // An application upgrade, or anything this build does not know.
    default:
      return FULL;
  }
  const events = (event.data as { events?: unknown } | undefined)?.events;
  // A mutation that carries no events (a state sync rather than a replayed
  // delta) says nothing about what changed.
  if (!Array.isArray(events) || events.length === 0) return FULL;

  const plan = empty();
  for (const e of events as ExecutionEvent[]) {
    const p = payload(e);
    switch (e.kind) {
      case 'CellUpdated':
      case 'CellCleared':
      case 'CellsChanged': {
        const sheet = p?.sheet_id;
        if (typeof sheet !== 'string') return FULL;
        plan.sheets.add(sheet);
        break;
      }
      case 'SheetCreated':
      case 'SheetRenamed':
        plan.sheetList = true;
        break;
      case 'SheetDeleted': {
        const sheet = p?.id;
        if (typeof sheet !== 'string') return FULL;
        plan.sheetList = true;
        // Re-reading a deleted sheet returns no cells, which clears it.
        plan.sheets.add(sheet);
        break;
      }
      case 'MemberJoined':
      case 'MemberRenamed':
      case 'RolesChanged':
        plan.members = true;
        break;
      // Rows or columns moved: the layout changes, and so do the node's values
      // for ranges on that sheet.
      case 'AxesChanged': {
        const sheet = p?.sheet_id;
        if (typeof sheet !== 'string') return FULL;
        plan.layouts = true;
        plan.sheets.add(sheet);
        break;
      }
      case 'NamedRangesChanged':
        plan.names = true;
        break;
      case 'CommentAdded':
      case 'CommentChanged':
        plan.comments = true;
        break;
      case 'NoteChanged':
        plan.notes = true;
        break;
      case 'ProtectionsChanged':
        plan.protections = true;
        break;
      case 'SheetViewChanged':
        plan.views = true;
        break;
      case 'StylesChanged':
        plan.styles = true;
        break;
      case 'RulesChanged':
        plan.rules = true;
        break;
      case 'ChartsChanged':
        plan.charts = true;
        break;
      default:
        return FULL;
    }
  }
  return plan;
}

/** Two plans as one, so a burst of events costs one round of reads. */
export function mergePlans(a: RefreshPlan | null, b: RefreshPlan | null): RefreshPlan | null {
  if (!a) return b;
  if (!b) return a;
  if (a.full || b.full) return FULL;
  return {
    full: false,
    sheets: new Set([...a.sheets, ...b.sheets]),
    sheetList: a.sheetList || b.sheetList,
    members: a.members || b.members,
    layouts: a.layouts || b.layouts,
    names: a.names || b.names,
    comments: a.comments || b.comments,
    notes: a.notes || b.notes,
    protections: a.protections || b.protections,
    views: a.views || b.views,
    styles: a.styles || b.styles,
    rules: a.rules || b.rules,
    charts: a.charts || b.charts,
  };
}

/** True when a plan reads nothing (every event was a no-op). */
export function isNoop(plan: RefreshPlan): boolean {
  return !plan.full && plan.sheets.size === 0 && !plan.sheetList && !plan.members && !plan.layouts && !plan.names && !plan.comments && !plan.notes && !plan.protections && !plan.views && !plan.styles && !plan.rules && !plan.charts;
}

/** A comment that names someone: who wrote it, where, and whom it names. */
export interface Mention {
  commentId: string;
  sheetId: string;
  author: string;
  mentions: string[];
}

/** The mentions an event carries (a `CommentAdded` naming anyone). */
export function mentionsIn(event: NodeEvent): Mention[] {
  if (event.type !== 'StateMutation') return [];
  const events = (event.data as { events?: unknown } | undefined)?.events;
  if (!Array.isArray(events)) return [];
  return (events as ExecutionEvent[]).flatMap((e) => {
    if (e.kind !== 'CommentAdded') return [];
    const p = payload(e);
    const { id, sheet_id, author, mentions } = p ?? {};
    if (typeof id !== 'string' || typeof sheet_id !== 'string' || typeof author !== 'string' || !Array.isArray(mentions)) {
      return [];
    }
    return [{ commentId: id, sheetId: sheet_id, author, mentions: mentions.filter((m): m is string => typeof m === 'string') }];
  });
}
