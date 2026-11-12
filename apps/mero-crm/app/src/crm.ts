/**
 * The pipeline's contract is called through `MeroCrmClient`, which
 * `mero-app-build codegen` writes from logic/res/abi.json
 * (`src/generated/client.ts`): camelCase arguments, u64s as decimal strings
 * (`u64`, `optU64` below). The ABI names its records without their shapes, so
 * the generated types are `unknown`: each answer passes through the `to*`
 * below into v1's shapes, which the screens were written against.
 */

// ── what the screens render ──────────────────────────────────────────────────
//
// v1's generated-client shapes, which the screens were written against. The
// contract still answers these snake_case fields; the one wire difference is a
// u64 as a decimal string, which `fromWire*` turns back into a number
// (milliseconds and whole currency units fit).

export interface StageView {
  id: string;
  name: string;
  probability: number;
  position: number;
}

export interface NextActivity {
  id: string;
  kind: string;
  subject: string;
  due_at: number;
}

export interface DealView {
  id: string;
  title: string;
  value: number;
  organization: string;
  contact_id: string | null;
  contact_name: string | null;
  owner: string | null;
  stage_id: string;
  status: string;
  lost_reason: string;
  expected_close: number | null;
  source: string;
  probability: number;
  stage_entered_at: number;
  closed_at: number | null;
  next_activity: NextActivity | null;
  open_activities: number;
  last_touch_at: number | null;
  /** The creator's account id: only they may delete the deal. */
  created_by: string;
  created_at: number;
}

export interface ContactView {
  id: string;
  name: string;
  email: string;
  phone: string;
  organization: string;
  job_title: string;
  open_deals: number;
  won_value: number;
  created_by: string;
  created_at: number;
}

export interface ActivityView {
  id: string;
  deal_id: string | null;
  deal_title: string | null;
  contact_id: string | null;
  kind: string;
  subject: string;
  due_at: number;
  done: boolean;
  done_at: number | null;
  owner: string | null;
  note: string;
  automation_id: string | null;
  created_by: string;
  created_at: number;
}

export interface NoteView {
  id: string;
  deal_id: string;
  /** The writer's account id: only they may delete it. */
  author: string;
  body: string;
  created_at: number;
}

export interface AutomationView {
  id: string;
  stage_id: string;
  kind: string;
  subject: string;
  due_in_days: number;
  enabled: boolean;
  created_by: string;
  created_at: number;
}

export interface DealDetail {
  deal: DealView;
  contact: ContactView | null;
  activities: ActivityView[];
  notes: NoteView[];
}

export interface Settings {
  currency: string;
  rotting_days: number;
}

// ── the wire ─────────────────────────────────────────────────────────────────

type Wire<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] extends number ? string : string | null };

type WireNext = Wire<NextActivity, 'due_at'>;
type WireDeal = Omit<
  Wire<DealView, 'value' | 'expected_close' | 'stage_entered_at' | 'closed_at' | 'last_touch_at' | 'created_at'>,
  'next_activity'
> & { next_activity: WireNext | null };
type WireContact = Wire<ContactView, 'won_value' | 'created_at'>;
type WireActivity = Wire<ActivityView, 'due_at' | 'done_at' | 'created_at'>;
type WireNote = Wire<NoteView, 'created_at'>;
type WireAutomation = Wire<AutomationView, 'created_at'>;

/** A u64 as the wire carries it (a decimal string) as a number. */
function int(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

function optInt(value: string | number | null | undefined): number | null {
  return value === null || value === undefined ? null : int(value);
}

export function fromWireDeal(w: WireDeal): DealView {
  return {
    ...w,
    value: int(w.value),
    expected_close: optInt(w.expected_close),
    stage_entered_at: int(w.stage_entered_at),
    closed_at: optInt(w.closed_at),
    last_touch_at: optInt(w.last_touch_at),
    created_at: int(w.created_at),
    next_activity: w.next_activity ? { ...w.next_activity, due_at: int(w.next_activity.due_at) } : null,
  };
}

export function fromWireContact(w: WireContact): ContactView {
  return { ...w, won_value: int(w.won_value), created_at: int(w.created_at) };
}

export function fromWireActivity(w: WireActivity): ActivityView {
  return { ...w, due_at: int(w.due_at), done_at: optInt(w.done_at), created_at: int(w.created_at) };
}

export function fromWireNote(w: WireNote): NoteView {
  return { ...w, created_at: int(w.created_at) };
}

export function fromWireAutomation(w: WireAutomation): AutomationView {
  return { ...w, created_at: int(w.created_at) };
}

/** A number the contract takes as a u64: a whole, non-negative decimal string. */
export function u64(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`not a whole non-negative number: ${n}`);
  return String(Math.floor(n));
}

export function optU64(n: number | null | undefined): string | null {
  return n === null || n === undefined ? null : u64(n);
}

// ── answers, in the screens' shapes ──────────────────────────────────────────

/** `getSettings`'s answer. */
export const toSettings = (v: unknown): Settings => v as Settings;
/** `listStages`'s answer (pipeline order). */
export const toStages = (v: unknown): StageView[] => v as StageView[];
/** `listDeals`'s answer. */
export const toDeals = (v: unknown): DealView[] => (v as WireDeal[]).map(fromWireDeal);
/** `listContacts`'s answer. */
export const toContacts = (v: unknown): ContactView[] => (v as WireContact[]).map(fromWireContact);
/** `listActivities`'s answer. */
export const toActivities = (v: unknown): ActivityView[] => (v as WireActivity[]).map(fromWireActivity);
/** `listAutomations`'s answer. */
export const toAutomations = (v: unknown): AutomationView[] => (v as WireAutomation[]).map(fromWireAutomation);

/** `getDeal`'s answer. */
export function toDealDetail(v: unknown): DealDetail {
  const d = v as { deal: WireDeal; contact: WireContact | null; activities: WireActivity[]; notes: WireNote[] };
  return {
    deal: fromWireDeal(d.deal),
    contact: d.contact ? fromWireContact(d.contact) : null,
    activities: d.activities.map(fromWireActivity),
    notes: d.notes.map(fromWireNote),
  };
}
