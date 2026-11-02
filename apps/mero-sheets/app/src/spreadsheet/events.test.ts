import { describe, expect, it } from 'vitest';
import { alertsIn, isNoop, mentionsIn, mergePlans, planFor, type RefreshPlan } from './events';

// The app's events as `client.events` streams them: one at a time, fields camelCase.
const mutation = (...events: [string, unknown][]) => events.map(([kind, data]) => ({ kind, data }));
const partial = (p: RefreshPlan | null) => {
  if (!p || p.full) throw new Error(`expected a partial plan, got ${JSON.stringify(p)}`);
  return p;
};

describe('planFor', () => {
  it('re-reads only the sheets whose cells changed', () => {
    const p = partial(planFor(mutation(
      ['CellUpdated', { id: 'k', sheetId: 's1' }],
      ['CellsChanged', { sheetId: 's2', count: 40 }],
      ['CellCleared', { sheetId: 's1', row: 0, col: 0 }],
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
    const axes = partial(planFor(mutation(['AxesChanged', { sheetId: 's1', count: 1 }])));
    expect(axes.layouts).toBe(true);
    expect([...axes.sheets]).toEqual(['s1']);
    const names = partial(planFor(mutation(['NamedRangesChanged', { name: 'Costs' }])));
    expect(names.names).toBe(true);
    expect(isNoop(names)).toBe(false);
  });

  it('falls back to a full refresh when it cannot tell what changed', () => {
    expect(planFor(mutation())).toEqual({ full: true });
    expect(planFor(mutation(['ProjectInitialized', { id: 'p', name: 'n' }]))).toEqual({ full: true });
    expect(planFor(mutation(['CellUpdated', { id: 'k' }]))).toEqual({ full: true });
    expect(planFor({ kind: 'AppVersionChanged', data: {} })).toEqual({ full: true });
  });
});

describe('mergePlans', () => {
  it('unions partial plans and lets a full plan win', () => {
    const a = planFor(mutation(['CellUpdated', { id: 'k', sheetId: 's1' }]));
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
    const ev = mutation(['CommentAdded', { id: 'c1', sheetId: 's1', author: 'ada', mentions: ['sam'] }]);
    expect(partial(planFor(ev)).comments).toBe(true);
    expect(mentionsIn(ev)).toEqual([{ commentId: 'c1', sheetId: 's1', author: 'ada', mentions: ['sam'] }]);
    expect(mentionsIn(mutation(['CommentChanged', { id: 'c1', sheetId: 's1' }]))).toEqual([]);
  });
});

describe('notes', () => {
  it('re-reads the noted cells on a note edit, and nothing else', () => {
    const p = partial(planFor(mutation(['NoteChanged', { sheetId: 's1', rowId: '0', colId: '1' }])));
    expect(p.notes).toBe(true);
    expect(p.sheets.size).toBe(0);
    expect(isNoop(p)).toBe(false);
  });
});

describe('roles and protections', () => {
  it('re-reads the roster on a role change and the protections on a protection change', () => {
    expect(partial(planFor(mutation(['RolesChanged', { memberId: 'ada' }]))).members).toBe(true);
    const p = partial(planFor(mutation(['ProtectionsChanged', { sheetId: 's1' }])));
    expect(p.protections).toBe(true);
    expect(p.sheets.size).toBe(0);
  });
});

describe('sheet views', () => {
  it('re-reads only the sheet views on a resize or freeze', () => {
    const p = partial(planFor(mutation(['SheetViewChanged', { sheetId: 's1' }])));
    expect(p.views).toBe(true);
    expect(p.sheets.size).toBe(0);
  });
});

describe('styles and rules', () => {
  it('re-reads styles or rules, and no cells', () => {
    const st = partial(planFor(mutation(['StylesChanged', { sheetId: 's1' }])));
    expect([st.styles, st.rules, st.sheets.size]).toEqual([true, false, 0]);
    expect(partial(planFor(mutation(['RulesChanged', { sheetId: 's1' }]))).rules).toBe(true);
  });
});

describe('charts', () => {
  it('re-reads only the charts', () => {
    const p = partial(planFor(mutation(['ChartsChanged', { sheetId: 's1' }])));
    expect([p.charts, p.sheets.size]).toEqual([true, 0]);
  });
});

describe('attachments', () => {
  it('re-reads only the attachments', () => {
    const p = partial(planFor(mutation(['AttachmentsChanged', { sheetId: 's1' }])));
    expect([p.attachments, p.sheets.size]).toEqual([true, 0]);
  });
});

describe('linked workbooks and alerts', () => {
  it('re-reads the tabs and the linked sheet when a link changes', () => {
    const p = partial(planFor(mutation(['LinkedChanged', { sheetId: 'link-ab-1' }])));
    expect(p.sheetList).toBe(true);
    expect([...p.sheets]).toEqual(['link-ab-1']);
    expect(partial(planFor(mutation(['PublicationsChanged', { sheetId: 's1' }]))).publications).toBe(true);
  });

  it('reads nothing for an alert, and says whom it tells', () => {
    const ev = mutation(['AlertTriggered', { ruleId: 'r1', sheetId: 's1', recipients: ['ada'], message: 'B2 is now over 100' }]);
    expect(isNoop(partial(planFor(ev)))).toBe(true);
    expect(alertsIn(ev)).toEqual([{ ruleId: 'r1', sheetId: 's1', recipients: ['ada'], message: 'B2 is now over 100' }]);
  });
});
