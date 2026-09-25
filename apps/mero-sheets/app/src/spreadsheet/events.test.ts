import { describe, expect, it } from 'vitest';
import { isNoop, mentionsIn, mergePlans, planFor, type RefreshPlan } from './events';

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

  it('re-reads the roster on member events', () => {
    expect(partial(planFor(mutation(['MemberJoined', { id: 'd', nickname: 'Ada' }]))).members).toBe(true);
  });

  it('re-reads the layout and that sheet on row/column changes, and names on name changes', () => {
    const axes = partial(planFor(mutation(['AxesChanged', { sheet_id: 's1', count: 1 }])));
    expect(axes.layouts).toBe(true);
    expect([...axes.sheets]).toEqual(['s1']);
    const names = partial(planFor(mutation(['NamedRangesChanged', { name: 'Costs' }])));
    expect(names.names).toBe(true);
    expect(isNoop(names)).toBe(false);
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

describe('comments', () => {
  it('re-reads comments on comment events and reports who was mentioned', () => {
    const ev = mutation(['CommentAdded', { id: 'c1', sheet_id: 's1', author: 'ada', mentions: ['sam'] }]);
    expect(partial(planFor(ev)).comments).toBe(true);
    expect(mentionsIn(ev)).toEqual([{ commentId: 'c1', sheetId: 's1', author: 'ada', mentions: ['sam'] }]);
    expect(mentionsIn(mutation(['CommentChanged', { id: 'c1', sheet_id: 's1' }]))).toEqual([]);
    expect(mentionsIn({ type: 'Ephemeral', data: {} })).toEqual([]);
  });
});

describe('notes', () => {
  it('re-reads the noted cells on a note edit, and nothing else', () => {
    const p = partial(planFor(mutation(['NoteChanged', { sheet_id: 's1', row_id: '0', col_id: '1' }])));
    expect(p.notes).toBe(true);
    expect(p.sheets.size).toBe(0);
    expect(isNoop(p)).toBe(false);
  });
});

describe('roles and protections', () => {
  it('re-reads the roster on a role change and the protections on a protection change', () => {
    expect(partial(planFor(mutation(['RolesChanged', { member_id: 'ada' }]))).members).toBe(true);
    const p = partial(planFor(mutation(['ProtectionsChanged', { sheet_id: 's1' }])));
    expect(p.protections).toBe(true);
    expect(p.sheets.size).toBe(0);
  });
});
