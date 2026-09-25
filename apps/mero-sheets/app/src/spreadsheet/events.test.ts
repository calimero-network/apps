import { describe, expect, it } from 'vitest';
import { isNoop, mergePlans, planFor, type RefreshPlan } from './events';

const bytes = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));
const mutation = (...events: [string, unknown][]) => ({
  type: 'StateMutation',
  data: { newRoot: 'x', events: events.map(([kind, data]) => ({ kind, data: bytes(data), handler: null })) },
});
const partial = (p: RefreshPlan | null) => {
  if (!p || p.full) throw new Error(`expected a partial plan, got ${JSON.stringify(p)}`);
  return p;
};

describe('planFor', () => {
  it('ignores presence, sync status and xcall reports', () => {
    expect(planFor({ type: 'Ephemeral', data: {} })).toBeNull();
    expect(planFor({ type: 'SyncStatus', data: {} })).toBeNull();
    expect(planFor({ type: 'XCall', data: {} })).toBeNull();
  });

  it('re-reads only the sheets whose cells changed', () => {
    const p = partial(planFor(mutation(
      ['CellUpdated', { id: 'k', sheet_id: 's1' }],
      ['CellsChanged', { sheet_id: 's2', count: 40 }],
      ['CellCleared', { sheet_id: 's1', row: 0, col: 0 }],
    )));
    expect([...p.sheets].sort()).toEqual(['s1', 's2']);
    expect(p.sheetList).toBe(false);
    expect(p.members).toBe(false);
  });

  it('re-reads the sheet list on sheet events, and clears a deleted sheet', () => {
    expect(partial(planFor(mutation(['SheetRenamed', { id: 's1', name: 'X' }]))).sheetList).toBe(true);
    const del = partial(planFor(mutation(['SheetDeleted', { id: 's3' }])));
    expect(del.sheetList).toBe(true);
    expect([...del.sheets]).toEqual(['s3']);
  });

  it('re-reads the roster on member events and skips legacy cursor events', () => {
    expect(partial(planFor(mutation(['MemberJoined', { id: 'd', nickname: 'Ada' }]))).members).toBe(true);
    expect(isNoop(partial(planFor(mutation(['CursorMoved', { author: 'a', sheet_id: 's' }]))))).toBe(true);
  });

  it('falls back to a full refresh when it cannot tell what changed', () => {
    expect(planFor(mutation())).toEqual({ full: true });
    expect(planFor({ type: 'StateMutation', data: { newRoot: 'x' } })).toEqual({ full: true });
    expect(planFor(mutation(['ProjectInitialized', { id: 'p', name: 'n' }]))).toEqual({ full: true });
    expect(planFor(mutation(['CellUpdated', { id: 'k' }]))).toEqual({ full: true });
    expect(planFor({ type: 'AppVersionChanged', data: {} })).toEqual({ full: true });
  });
});

describe('mergePlans', () => {
  it('unions partial plans and lets a full plan win', () => {
    const a = planFor(mutation(['CellUpdated', { id: 'k', sheet_id: 's1' }]));
    const b = planFor(mutation(['MemberJoined', { id: 'd', nickname: 'Ada' }]));
    const m = partial(mergePlans(a, b));
    expect([...m.sheets]).toEqual(['s1']);
    expect(m.members).toBe(true);
    expect(mergePlans(m, { full: true })).toEqual({ full: true });
    expect(mergePlans(null, a)).toBe(a);
  });
});
