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
  | { full: false; sheets: Set<string>; sheetList: boolean; members: boolean; layouts: boolean; names: boolean; comments: boolean; notes: boolean; protections: boolean; views: boolean; styles: boolean; rules: boolean; charts: boolean; attachments: boolean; publications: boolean };

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
  attachments: false,
  publications: false,
});

const FULL: RefreshPlan = { full: true };

/**
 * One of the app's events as `client.events` streams it (`{ id, kind, data }`):
 * the contract's event name and its fields, camelCase.
 */
export interface AppEvent {
  kind?: string;
  data?: unknown;
}

function fields(e: AppEvent): Record<string, unknown> | null {
  return e.data && typeof e.data === 'object' ? (e.data as Record<string, unknown>) : null;
}

/**
 * The plan for one event (or a burst of them), or `null` when it changes
 * nothing this hook shows.
 */
export function planFor(event: AppEvent | readonly AppEvent[]): RefreshPlan | null {
  const events = Array.isArray(event) ? event : [event as AppEvent];
  // Nothing to go on: read everything.
  if (events.length === 0) return FULL;

  const plan = empty();
  for (const e of events) {
    const p = fields(e);
    switch (e.kind) {
      case 'CellUpdated':
      case 'CellCleared':
      case 'CellsChanged': {
        const sheet = p?.sheetId;
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
        const sheet = p?.sheetId;
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
      case 'AttachmentsChanged':
        plan.attachments = true;
        break;
      case 'PublicationsChanged':
        plan.publications = true;
        break;
      // A linked sheet arrived, changed or went: the tabs, and its values.
      case 'LinkedChanged': {
        const sheet = p?.sheetId;
        if (typeof sheet !== 'string') return FULL;
        plan.sheetList = true;
        plan.sheets.add(sheet);
        break;
      }
      // Tells people something; changes nothing to read.
      case 'AlertTriggered':
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
    attachments: a.attachments || b.attachments,
    publications: a.publications || b.publications,
  };
}

/** True when a plan reads nothing (every event was a no-op). */
export function isNoop(plan: RefreshPlan): boolean {
  return !plan.full && plan.sheets.size === 0 && !plan.sheetList && !plan.members && !plan.layouts && !plan.names && !plan.comments && !plan.notes && !plan.protections && !plan.views && !plan.styles && !plan.rules && !plan.charts && !plan.attachments && !plan.publications;
}

/** A comment that names someone: who wrote it, where, and whom it names. */
export interface Mention {
  commentId: string;
  sheetId: string;
  author: string;
  mentions: string[];
}

/** The mentions an event carries (a `CommentAdded` naming anyone). */
export function mentionsIn(event: AppEvent | readonly AppEvent[]): Mention[] {
  if (Array.isArray(event)) return event.flatMap((e: AppEvent) => mentionsIn(e));
  event = event as AppEvent;
  if (event.kind !== 'CommentAdded') return [];
  const { id, sheetId, author, mentions } = fields(event) ?? {};
  if (typeof id !== 'string' || typeof sheetId !== 'string' || typeof author !== 'string' || !Array.isArray(mentions)) {
    return [];
  }
  return [{ commentId: id, sheetId, author, mentions: mentions.filter((m): m is string => typeof m === 'string') }];
}

/** An alert rule firing: whom it tells, and what. */
export interface Alert {
  ruleId: string;
  sheetId: string;
  recipients: string[];
  message: string;
}

/** The alerts an event carries. */
export function alertsIn(event: AppEvent | readonly AppEvent[]): Alert[] {
  if (Array.isArray(event)) return event.flatMap((e: AppEvent) => alertsIn(e));
  event = event as AppEvent;
  if (event.kind !== 'AlertTriggered') return [];
  const { ruleId, sheetId, recipients, message } = fields(event) ?? {};
  if (typeof ruleId !== 'string' || typeof sheetId !== 'string' || typeof message !== 'string' || !Array.isArray(recipients)) {
    return [];
  }
  return [{ ruleId, sheetId, message, recipients: recipients.filter((r): r is string => typeof r === 'string') }];
}
