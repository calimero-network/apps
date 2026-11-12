import { describe, expect, it, vi } from 'vitest';

import { MeroCrmClient } from './generated/client';
import { optU64, toActivities, toContacts, toDeals, u64 } from './crm';
import { withRoutes } from '@calimero-apps/connect/testing';

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

describe('the pipeline through the generated client', () => {
  it('sends u64 arguments as decimal strings', async () => {
    const { sent, transport } = client();
    const c = new MeroCrmClient(withRoutes(transport), 'app-1');
    await c.createDeal({
      title: 't', value: u64(24000), organization: '', contactId: null, stageId: 's', owner: null,
      expectedClose: optU64(1893456000000), source: '',
    });
    await c.rescheduleActivity({ activityId: 'a', dueAt: u64(1700000000000) });
    expect(sent.get('createDeal')).toMatchObject({ value: '24000', expectedClose: '1893456000000', contactId: null });
    expect(sent.get('rescheduleActivity')).toEqual({ activityId: 'a', dueAt: '1700000000000' });
  });

  it('answers v1 shapes, with u64s as numbers', async () => {
    const { transport } = client({
      listDeals: [WIRE_DEAL],
      listActivities: [WIRE_ACTIVITY],
      listContacts: [{ id: 'c', name: 'Ada', email: '', phone: '', organization: '', job_title: '', open_deals: 1, won_value: '7', created_by: 'a', created_at: '3' }],
    });
    const c = new MeroCrmClient(withRoutes(transport), 'app-1');
    const [deal] = toDeals(await c.listDeals({ status: null, stageId: null, owner: null }));
    expect(deal.value).toBe(24000);
    expect(deal.expected_close).toBe(1893456000000);
    expect(deal.closed_at).toBeNull();
    expect(deal.next_activity?.due_at).toBe(1700000001000);
    expect(deal.created_at).toBe(1700000000000);
    const [activity] = toActivities(await c.listActivities({ dealId: null, done: null }));
    expect(activity.due_at).toBe(1700000001000);
    expect(activity.done_at).toBe(1700000002000);
    const [contact] = toContacts(await c.listContacts());
    expect(contact.won_value).toBe(7);
    expect(contact.created_at).toBe(3);
  });

  it('runs `after` after every request, failed ones too', async () => {
    const after = vi.fn();
    const transport = withRoutes({
      call: vi.fn(() => Promise.reject(new Error('boom'))),
      view: vi.fn(() => Promise.resolve({ index: 1, result: [], events: [] })),
    });
    const c = new MeroCrmClient(transport, 'app-1', { after });
    await c.listStages();
    await expect(c.markWon({ dealId: 'd' })).rejects.toThrow('boom');
    expect(after).toHaveBeenCalledTimes(2);
  });
});
