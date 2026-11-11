import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { CALLS, VIEWS, crm } from './crm';
import { withRoutes } from '@calimero-apps/connect/testing';

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, '../../logic/res/abi.json'), 'utf8')) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

const WIRE_DEAL = {
  id: 'deal-1-aa',
  title: 'T',
  value: '24000',
  organization: 'Acme',
  contact_id: 'contact-1',
  contact_name: 'Ada',
  owner: 'acct-a',
  stage_id: 'stage-lead',
  status: 'open',
  lost_reason: '',
  expected_close: '1893456000000',
  source: '',
  probability: 10,
  stage_entered_at: '1700000000000',
  closed_at: null,
  next_activity: { id: 'activity-1', kind: 'call', subject: 'Intro', due_at: '1700000001000' },
  open_activities: 1,
  last_touch_at: null,
  created_by: 'acct-a',
  created_at: '1700000000000',
};

const WIRE_ACTIVITY = {
  id: 'activity-1',
  deal_id: 'deal-1-aa',
  deal_title: 'T',
  contact_id: null,
  kind: 'call',
  subject: 'Intro',
  due_at: '1700000001000',
  done: true,
  done_at: '1700000002000',
  owner: null,
  note: '',
  automation_id: null,
  created_by: 'acct-a',
  created_at: '1700000000000',
};

function client(answers: Record<string, unknown> = {}) {
  const sent = new Map<string, Record<string, unknown>>();
  const record = (_app: string, method: string, args: unknown = {}) => {
    sent.set(method, args as Record<string, unknown>);
    return Promise.resolve({ index: 1, result: answers[method] ?? (method.startsWith('list') ? [] : null), events: [] });
  };
  return { sent, transport: withRoutes({ call: vi.fn(record), view: vi.fn(record) }) };
}

describe('the client covers the contract', () => {
  it('calls exactly the contract calls, and views exactly its views', () => {
    expect([...CALLS].sort()).toEqual(byKind('call'));
    expect([...VIEWS].sort()).toEqual(byKind('view'));
    expect(byKind('init')).toEqual(['init']);
  });

  it('sends each method the parameter names the ABI declares', async () => {
    const { sent, transport } = client({
      getDeal: { deal: WIRE_DEAL, contact: null, activities: [], notes: [] },
      getSettings: { currency: 'USD', rotting_days: 14 },
    });
    const c = crm(withRoutes(transport), 'app-1');
    await Promise.all([
      c.getSettings(),
      c.setCurrency({ currency: 'EUR' }),
      c.setRottingDays({ days: 7 }),
      c.listStages(),
      c.addStage({ name: 'S', probability: 50 }),
      c.updateStage({ stage_id: 's', name: 'S', probability: 50 }),
      c.reorderStages({ stage_ids: ['s'] }),
      c.deleteStage({ stage_id: 's' }),
      c.createDeal({ title: 't', value: 1, organization: '', contact_id: null, stage_id: 's', owner: null, expected_close: null, source: '' }),
      c.updateDeal({ deal_id: 'd', title: 't', value: 1, organization: '', contact_id: null, owner: null, expected_close: 5, source: '' }),
      c.moveDeal({ deal_id: 'd', stage_id: 's' }),
      c.markWon({ deal_id: 'd' }),
      c.markLost({ deal_id: 'd', reason: 'Price' }),
      c.reopenDeal({ deal_id: 'd' }),
      c.listDeals({ status: null, stage_id: null, owner: null }),
      c.getDeal({ deal_id: 'd' }),
      c.deleteDeal({ deal_id: 'd' }),
      c.createContact({ name: 'n', email: '', phone: '', organization: '', job_title: '' }),
      c.updateContact({ contact_id: 'c', name: 'n', email: '', phone: '', organization: '', job_title: '' }),
      c.deleteContact({ contact_id: 'c' }),
      c.listContacts(),
      c.addActivity({ deal_id: null, contact_id: null, kind: 'call', subject: 's', due_at: 1, owner: null, note: '' }),
      c.setActivityDone({ activity_id: 'a', done: true }),
      c.rescheduleActivity({ activity_id: 'a', due_at: 2 }),
      c.deleteActivity({ activity_id: 'a' }),
      c.listActivities({ deal_id: null, done: null }),
      c.addNote({ deal_id: 'd', body: 'b' }),
      c.deleteNote({ note_id: 'n' }),
      c.listAutomations(),
      c.addAutomation({ stage_id: 's', kind: 'task', subject: 's', due_in_days: 1 }),
      c.setAutomationEnabled({ automation_id: 'x', enabled: false }),
      c.deleteAutomation({ automation_id: 'x' }),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === 'init') continue;
      expect(Object.keys(sent.get(name) ?? {}).sort(), name).toEqual(method.params.map(([p]) => p).sort());
    }
  });

  it('sends u64 arguments as decimal strings', async () => {
    const { sent, transport } = client();
    const c = crm(withRoutes(transport), 'app-1');
    await c.createDeal({
      title: 't', value: 24000, organization: '', contact_id: null, stage_id: 's', owner: null,
      expected_close: 1893456000000, source: '',
    });
    await c.rescheduleActivity({ activity_id: 'a', due_at: 1700000000000 });
    expect(sent.get('createDeal')).toMatchObject({ value: '24000', expectedClose: '1893456000000', contactId: null });
    expect(sent.get('rescheduleActivity')).toEqual({ activityId: 'a', dueAt: '1700000000000' });
  });

  it('answers v1 shapes, with u64s as numbers', async () => {
    const { transport } = client({
      listDeals: [WIRE_DEAL],
      listActivities: [WIRE_ACTIVITY],
      listContacts: [{ id: 'c', name: 'Ada', email: '', phone: '', organization: '', job_title: '', open_deals: 1, won_value: '7', created_by: 'a', created_at: '3' }],
    });
    const c = crm(withRoutes(transport), 'app-1');
    const [deal] = await c.listDeals({ status: null, stage_id: null, owner: null });
    expect(deal.value).toBe(24000);
    expect(deal.expected_close).toBe(1893456000000);
    expect(deal.closed_at).toBeNull();
    expect(deal.next_activity?.due_at).toBe(1700000001000);
    expect(deal.created_at).toBe(1700000000000);
    const [activity] = await c.listActivities({ deal_id: null, done: null });
    expect(activity.due_at).toBe(1700000001000);
    expect(activity.done_at).toBe(1700000002000);
    const [contact] = await c.listContacts();
    expect(contact.won_value).toBe(7);
    expect(contact.created_at).toBe(3);
  });

  it('runs `after` after every request, failed ones too', async () => {
    const after = vi.fn();
    const transport = withRoutes({
      call: vi.fn(() => Promise.reject(new Error('boom'))),
      view: vi.fn(() => Promise.resolve({ index: 1, result: [], events: [] })),
    });
    const c = crm(transport as never, 'app-1', after);
    await c.listStages();
    await expect(c.markWon({ deal_id: 'd' })).rejects.toThrow('boom');
    expect(after).toHaveBeenCalledTimes(2);
  });
});
