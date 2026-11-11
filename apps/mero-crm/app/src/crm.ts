import { type ClientRoutes } from '@calimero-apps/connect';

/**
 * The contract's methods by their ABI names (camelCase), split the way the node
 * runs them: a call goes through the app's log, a view is answered by a node
 * without writing. `crm.test.ts` asserts these lists are exactly the committed
 * `logic/res/abi.json`'s, so a method the contract drops or renames fails a
 * test rather than a request.
 */
export const CALLS = [
  'setCurrency',
  'setRottingDays',
  'addStage',
  'updateStage',
  'reorderStages',
  'deleteStage',
  'createDeal',
  'updateDeal',
  'moveDeal',
  'markWon',
  'markLost',
  'reopenDeal',
  'deleteDeal',
  'createContact',
  'updateContact',
  'deleteContact',
  'addActivity',
  'setActivityDone',
  'rescheduleActivity',
  'deleteActivity',
  'addNote',
  'deleteNote',
  'addAutomation',
  'setAutomationEnabled',
  'deleteAutomation',
] as const;
export const VIEWS = [
  'getSettings',
  'listStages',
  'listDeals',
  'getDeal',
  'listContacts',
  'listActivities',
  'listAutomations',
] as const;

export type Call = (typeof CALLS)[number];
export type View = (typeof VIEWS)[number];

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

function fromWireNote(w: WireNote): NoteView {
  return { ...w, created_at: int(w.created_at) };
}

function fromWireAutomation(w: WireAutomation): AutomationView {
  return { ...w, created_at: int(w.created_at) };
}

/** A number the contract takes as a u64: a whole, non-negative decimal string. */
function u64(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`not a whole non-negative number: ${n}`);
  return String(Math.floor(n));
}

function optU64(n: number | null | undefined): string | null {
  return n === null || n === undefined ? null : u64(n);
}

// ── the client ───────────────────────────────────────────────────────────────

/**
 * The pipeline, with v1's generated `CrmClient` surface: the same method names
 * and the same snake_case argument objects, so the screens did not change. No
 * client is generated from a component ABI yet.
 */
export interface Crm {
  getSettings(): Promise<Settings>;
  setCurrency(p: { currency: string }): Promise<void>;
  setRottingDays(p: { days: number }): Promise<void>;
  /** Pipeline order. */
  listStages(): Promise<StageView[]>;
  addStage(p: { name: string; probability: number }): Promise<string>;
  updateStage(p: { stage_id: string; name: string; probability: number }): Promise<void>;
  reorderStages(p: { stage_ids: string[] }): Promise<void>;
  deleteStage(p: { stage_id: string }): Promise<void>;
  createDeal(p: {
    title: string;
    value: number;
    organization: string;
    contact_id: string | null;
    stage_id: string;
    owner: string | null;
    expected_close: number | null;
    source: string;
  }): Promise<string>;
  updateDeal(p: {
    deal_id: string;
    title: string;
    value: number;
    organization: string;
    contact_id: string | null;
    owner: string | null;
    expected_close: number | null;
    source: string;
  }): Promise<void>;
  moveDeal(p: { deal_id: string; stage_id: string }): Promise<void>;
  markWon(p: { deal_id: string }): Promise<void>;
  markLost(p: { deal_id: string; reason: string }): Promise<void>;
  reopenDeal(p: { deal_id: string }): Promise<void>;
  /** Newest first, at most the newest 1,000; `null` is no filter. */
  listDeals(p: { status: string | null; stage_id: string | null; owner: string | null }): Promise<DealView[]>;
  /** `AppError` `NotFound` for an unknown deal. */
  getDeal(p: { deal_id: string }): Promise<DealDetail>;
  /** `AppError` `Forbidden` for anyone but the creator. */
  deleteDeal(p: { deal_id: string }): Promise<void>;
  createContact(p: {
    name: string;
    email: string;
    phone: string;
    organization: string;
    job_title: string;
  }): Promise<string>;
  updateContact(p: {
    contact_id: string;
    name: string;
    email: string;
    phone: string;
    organization: string;
    job_title: string;
  }): Promise<void>;
  /** `AppError` `Forbidden` for anyone but the creator. */
  deleteContact(p: { contact_id: string }): Promise<void>;
  /** By name, at most 1,000. */
  listContacts(): Promise<ContactView[]>;
  addActivity(p: {
    deal_id: string | null;
    contact_id: string | null;
    kind: string;
    subject: string;
    due_at: number;
    owner: string | null;
    note: string;
  }): Promise<string>;
  setActivityDone(p: { activity_id: string; done: boolean }): Promise<void>;
  rescheduleActivity(p: { activity_id: string; due_at: number }): Promise<void>;
  deleteActivity(p: { activity_id: string }): Promise<void>;
  /** By due date, at most 1,000. */
  listActivities(p: { deal_id: string | null; done: boolean | null }): Promise<ActivityView[]>;
  addNote(p: { deal_id: string; body: string }): Promise<string>;
  /** `AppError` `Forbidden` for anyone but the author. */
  deleteNote(p: { note_id: string }): Promise<void>;
  listAutomations(): Promise<AutomationView[]>;
  addAutomation(p: { stage_id: string; kind: string; subject: string; due_in_days: number }): Promise<string>;
  setAutomationEnabled(p: { automation_id: string; enabled: boolean }): Promise<void>;
  deleteAutomation(p: { automation_id: string }): Promise<void>;
}

/** v1's generated-client name for the same surface. */
export type CrmClient = Crm;

export type Transport = ClientRoutes<{ apps: 'call' | 'view' }>;

/**
 * The pipeline at app instance `app` through `client`. `after` runs after every
 * request (the session store keeps a refreshed session there).
 */
export function crm(client: Transport, app: string, after: () => void = () => {}): Crm {
  const call = async <T>(method: Call, args: Record<string, unknown> = {}): Promise<T> => {
    try {
      return (await client.apps.call({ app, method, args })).result as T;
    } finally {
      after();
    }
  };
  const view = async <T>(method: View, args: Record<string, unknown> = {}): Promise<T> => {
    try {
      return (await client.apps.view({ app, method, args })).result as T;
    } finally {
      after();
    }
  };
  const done = async (p: Promise<unknown>): Promise<void> => {
    await p;
  };
  return {
    getSettings: () => view('getSettings'),
    setCurrency: ({ currency }) => done(call('setCurrency', { currency })),
    setRottingDays: ({ days }) => done(call('setRottingDays', { days })),
    listStages: () => view('listStages'),
    addStage: ({ name, probability }) => call('addStage', { name, probability }),
    updateStage: (p) => done(call('updateStage', { stageId: p.stage_id, name: p.name, probability: p.probability })),
    reorderStages: (p) => done(call('reorderStages', { stageIds: p.stage_ids })),
    deleteStage: (p) => done(call('deleteStage', { stageId: p.stage_id })),
    createDeal: (p) =>
      call('createDeal', {
        title: p.title,
        value: u64(p.value),
        organization: p.organization,
        contactId: p.contact_id,
        stageId: p.stage_id,
        owner: p.owner,
        expectedClose: optU64(p.expected_close),
        source: p.source,
      }),
    updateDeal: (p) =>
      done(
        call('updateDeal', {
          dealId: p.deal_id,
          title: p.title,
          value: u64(p.value),
          organization: p.organization,
          contactId: p.contact_id,
          owner: p.owner,
          expectedClose: optU64(p.expected_close),
          source: p.source,
        }),
      ),
    moveDeal: (p) => done(call('moveDeal', { dealId: p.deal_id, stageId: p.stage_id })),
    markWon: (p) => done(call('markWon', { dealId: p.deal_id })),
    markLost: (p) => done(call('markLost', { dealId: p.deal_id, reason: p.reason })),
    reopenDeal: (p) => done(call('reopenDeal', { dealId: p.deal_id })),
    listDeals: async (p) =>
      (await view<WireDeal[]>('listDeals', { status: p.status, stageId: p.stage_id, owner: p.owner })).map(
        fromWireDeal,
      ),
    getDeal: async (p) => {
      const d = await view<{
        deal: WireDeal;
        contact: WireContact | null;
        activities: WireActivity[];
        notes: WireNote[];
      }>('getDeal', { dealId: p.deal_id });
      return {
        deal: fromWireDeal(d.deal),
        contact: d.contact ? fromWireContact(d.contact) : null,
        activities: d.activities.map(fromWireActivity),
        notes: d.notes.map(fromWireNote),
      };
    },
    deleteDeal: (p) => done(call('deleteDeal', { dealId: p.deal_id })),
    createContact: (p) =>
      call('createContact', {
        name: p.name,
        email: p.email,
        phone: p.phone,
        organization: p.organization,
        jobTitle: p.job_title,
      }),
    updateContact: (p) =>
      done(
        call('updateContact', {
          contactId: p.contact_id,
          name: p.name,
          email: p.email,
          phone: p.phone,
          organization: p.organization,
          jobTitle: p.job_title,
        }),
      ),
    deleteContact: (p) => done(call('deleteContact', { contactId: p.contact_id })),
    listContacts: async () => (await view<WireContact[]>('listContacts')).map(fromWireContact),
    addActivity: (p) =>
      call('addActivity', {
        dealId: p.deal_id,
        contactId: p.contact_id,
        kind: p.kind,
        subject: p.subject,
        dueAt: u64(p.due_at),
        owner: p.owner,
        note: p.note,
      }),
    setActivityDone: (p) => done(call('setActivityDone', { activityId: p.activity_id, done: p.done })),
    rescheduleActivity: (p) => done(call('rescheduleActivity', { activityId: p.activity_id, dueAt: u64(p.due_at) })),
    deleteActivity: (p) => done(call('deleteActivity', { activityId: p.activity_id })),
    listActivities: async (p) =>
      (await view<WireActivity[]>('listActivities', { dealId: p.deal_id, done: p.done })).map(fromWireActivity),
    addNote: (p) => call('addNote', { dealId: p.deal_id, body: p.body }),
    deleteNote: (p) => done(call('deleteNote', { noteId: p.note_id })),
    listAutomations: async () => (await view<WireAutomation[]>('listAutomations')).map(fromWireAutomation),
    addAutomation: (p) =>
      call('addAutomation', { stageId: p.stage_id, kind: p.kind, subject: p.subject, dueInDays: p.due_in_days }),
    setAutomationEnabled: (p) =>
      done(call('setAutomationEnabled', { automationId: p.automation_id, enabled: p.enabled })),
    deleteAutomation: (p) => done(call('deleteAutomation', { automationId: p.automation_id })),
  };
}
