import { describe, expect, it, vi } from 'vitest';
import { MeroDocsClient, toDoc, toSearchPage, toTitleApplied, toViews, wireOps } from '../docsApi';
import { withRoutes } from '@calimero-apps/connect/testing';

/** A transport that records what each method sends. */
function recorder(result: unknown = null) {
  const sent: Array<{ kind: 'call' | 'view'; method: string; args: Record<string, unknown> }> = [];
  const transport = withRoutes({
    call: vi.fn(async (_app: string, method: string, args: Record<string, unknown>) => {
      sent.push({ kind: 'call', method, args });
      return { index: 1, result, events: [] };
    }),
    view: vi.fn(async (_app: string, method: string, args: Record<string, unknown>) => {
      sent.push({ kind: 'view', method, args });
      return { index: 1, result };
    }),
  });
  return { transport, sent };
}

describe('docsApi results', () => {
  it('reads a document back in v1 shape: snake_case, nanoseconds', async () => {
    const { transport } = recorder({
      id: 'd',
      title: 'T',
      tags: ['a'],
      archived: false,
      createdAt: '1700000000000',
      updatedAt: '1700000001000',
      createdBy: 'alice',
      updatedBy: 'bob',
      canDelete: true,
    });
    const doc = toDoc(await new MeroDocsClient(transport, 'app').getDoc({ id: 'd' }));
    expect(doc).toEqual({
      id: 'd',
      title: 'T',
      tags: ['a'],
      archived: false,
      created_at: 1_700_000_000_000 * 1_000_000,
      updated_at: 1_700_000_001_000 * 1_000_000,
      created_by: 'alice',
      updated_by: 'bob',
      can_delete: true,
    });
  });

  it('renames anchorPos and drops an absent attributes key from the ops it sends', async () => {
    const { transport, sent } = recorder({ applied: true, token: 't', text: 'a', anchor: 'x', anchorPos: 1, ids: [] });
    const out = toTitleApplied(
      await new MeroDocsClient(transport, 'app').titleApplyDeltaOn({
        doc: 'd',
        base: '',
        ops: wireOps([{ insert: 'a', attributes: null }, { retain: 1, attributes: { bold: 'true' } }, { delete: 1 }]),
        anchor: null,
      }),
    );
    expect(out.anchor_pos).toBe(1);
    expect(sent[0].args.ops).toEqual([{ insert: 'a' }, { retain: 1, attributes: { bold: 'true' } }, { delete: 1 }]);
  });

  it('reads counts and search totals from decimal strings', async () => {
    const { transport } = recorder({ hits: [], total: '12', nextCursor: 20 });
    const page = toSearchPage(
      await new MeroDocsClient(transport, 'app').searchDocs({
        query: 'q',
        includeArchived: false,
        cursor: null,
        limit: null,
      }),
    );
    expect(page).toEqual({ hits: [], total: 12, next_cursor: 20 });
  });

  it("reads a saved view's author back in v1 shape", () => {
    expect(toViews([{ id: 'v', name: 'n', query: 'q', createdBy: 'alice' }])).toEqual([
      { id: 'v', name: 'n', query: 'q', created_by: 'alice' },
    ]);
    expect(toViews(null)).toEqual([]);
  });
});
