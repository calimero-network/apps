import { describe, expect, it } from 'vitest';
import type { DealView, StageView } from '../generated/CrmClient';
import {
  DAY_MS,
  bucketActivities,
  computeStats,
  dealHealth,
  dealMatches,
  draftFollowUpEmail,
  dueLabel,
  fromDateInput,
  nextBestActions,
  parseMoney,
  toDateInput,
} from './crm';

const NOW = new Date(2026, 5, 15, 12).getTime();

const STAGES: StageView[] = [
  { id: 's1', name: 'Lead in', probability: 10, position: 0 },
  { id: 's2', name: 'Qualified', probability: 25, position: 1 },
  { id: 's3', name: 'Proposal', probability: 60, position: 2 },
  { id: 's4', name: 'Negotiation', probability: 80, position: 3 },
];

function deal(over: Partial<DealView> = {}): DealView {
  return {
    id: 'd1', title: 'Rollout', value: 10_000, organization: 'Acme', contact_id: 'c1', contact_name: 'Ada Byron',
    owner: 'alice', stage_id: 's2', status: 'open', lost_reason: '', expected_close: NOW + 20 * DAY_MS,
    source: 'referral', probability: 25, stage_entered_at: NOW - DAY_MS, closed_at: null,
    next_activity: { id: 'a1', kind: 'call', subject: 'Call', due_at: NOW + DAY_MS },
    open_activities: 1, last_touch_at: NOW - DAY_MS, created_by: 'k', created_at: NOW - 3 * DAY_MS,
    ...over,
  };
}

describe('money', () => {
  it('parses shorthand', () => {
    expect(parseMoney('12k')).toBe(12_000);
    expect(parseMoney('$1,250')).toBe(1_250);
    expect(parseMoney('1.5m')).toBe(1_500_000);
    expect(parseMoney('')).toBe(0);
    expect(parseMoney('lots')).toBeNull();
  });
});

describe('dates', () => {
  it('labels due dates relative to today', () => {
    expect(dueLabel(NOW - 2 * DAY_MS, NOW)).toEqual({ text: 'Overdue 2d', tone: 'overdue' });
    expect(dueLabel(NOW, NOW).tone).toBe('today');
    expect(dueLabel(NOW + DAY_MS, NOW).text).toBe('Tomorrow');
    expect(dueLabel(NOW + 30 * DAY_MS, NOW).tone).toBe('later');
  });
  it('round-trips a date input', () => {
    expect(toDateInput(fromDateInput('2026-03-04'))).toBe('2026-03-04');
    expect(fromDateInput('nope')).toBeNull();
  });
});

describe('dealHealth', () => {
  it('scores a well-run deal healthy', () => {
    const h = dealHealth(deal(), 14, NOW);
    expect(h.level).toBe('healthy');
    expect(h.score).toBe(100);
    expect(h.reasons).toEqual([]);
  });
  it('flags a neglected deal as critical and rotting', () => {
    const h = dealHealth(
      deal({ next_activity: null, last_touch_at: null, stage_entered_at: NOW - 40 * DAY_MS, created_at: NOW - 40 * DAY_MS, contact_id: null, expected_close: NOW - 5 * DAY_MS }),
      14,
      NOW,
    );
    expect(h.rotting).toBe(true);
    expect(h.level).toBe('critical');
    expect(h.reasons).toContain('No next step scheduled');
    expect(h.reasons).toContain('Expected close date has passed');
    expect(h.winLikelihood).toBeLessThan(25);
  });
  it('treats closed deals as settled', () => {
    expect(dealHealth(deal({ status: 'won', probability: 100 }), 14, NOW).score).toBe(100);
  });
});

describe('nextBestActions', () => {
  it('suggests the playbook step when there is no next activity', () => {
    const actions = nextBestActions(deal({ next_activity: null, stage_id: 's1' }), STAGES, 14, NOW);
    expect(actions[0].id).toBe('playbook');
    expect(actions[0].activity?.kind).toBe('call');
  });
  it('asks for a contact and a close date when missing', () => {
    const ids = nextBestActions(deal({ contact_id: null, expected_close: null }), STAGES, 14, NOW).map((a) => a.id);
    expect(ids).toEqual(['contact', 'close-date']);
  });
  it('is quiet for a closed deal', () => {
    expect(nextBestActions(deal({ status: 'lost' }), STAGES, 14, NOW)).toEqual([]);
  });
});

describe('draftFollowUpEmail', () => {
  it('greets the contact by first name and fits the stage', () => {
    const email = draftFollowUpEmail(deal({ stage_id: 's3' }), STAGES, null, 'Sam');
    expect(email.body.startsWith('Hi Ada,')).toBe(true);
    expect(email.subject).toBe('Proposal for Acme');
    expect(email.body.endsWith('Sam')).toBe(true);
  });
});

describe('computeStats', () => {
  it('totals, weights and win rate', () => {
    const deals = [
      deal({ id: 'a', value: 1000, probability: 50, stage_id: 's3', expected_close: new Date(2026, 6, 10).getTime() }),
      deal({ id: 'slipped', value: 200, probability: 50, stage_id: 's3', expected_close: NOW - 40 * DAY_MS }),
      deal({ id: 'b', value: 3000, status: 'won', probability: 100, closed_at: NOW, created_at: NOW - 10 * DAY_MS }),
      deal({ id: 'c', value: 500, status: 'lost', probability: 0, lost_reason: 'Price' }),
    ];
    const s = computeStats(deals, STAGES, NOW);
    expect(s.openValue).toBe(1200);
    expect(s.weightedValue).toBe(600);
    expect(s.winRate).toBe(50);
    expect(s.avgCycleDays).toBe(10);
    expect(s.wonThisMonth).toBe(3000);
    expect(s.lostReasons).toEqual([{ reason: 'Price', count: 1 }]);
    expect(s.perStage.find((p) => p.stage.id === 's3')?.count).toBe(2);
    // A slipped close date is due now, so it counts in the current month.
    expect(s.forecast[0].value).toBe(200);
    expect(s.forecast[1].value).toBe(1000);
  });
});

describe('activities and search', () => {
  it('buckets by due date', () => {
    const base = { id: 'x', deal_id: null, deal_title: null, contact_id: null, kind: 'call', subject: 's', done_at: null, owner: null, note: '', automation_id: null, created_by: 'k', created_at: 0 };
    const b = bucketActivities([
      { ...base, id: '1', due_at: NOW - 2 * DAY_MS, done: false },
      { ...base, id: '2', due_at: NOW, done: false },
      { ...base, id: '3', due_at: NOW + 3 * DAY_MS, done: false },
      { ...base, id: '4', due_at: NOW, done: true, done_at: NOW },
    ], NOW);
    expect([b.overdue.length, b.today.length, b.upcoming.length, b.done.length]).toEqual([1, 1, 1, 1]);
  });
  it('matches deals by title, org and contact', () => {
    expect(dealMatches(deal(), 'acme')).toBe(true);
    expect(dealMatches(deal(), 'ada')).toBe(true);
    expect(dealMatches(deal(), 'zzz')).toBe(false);
  });
});
