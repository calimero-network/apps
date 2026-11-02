import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { APP_ONLY_METHODS, CONTRACT_METHODS, CONTRACT_VIEWS, SpreadsheetClient, fromWire, u64 } from './SpreadsheetClient';

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, '../../../../logic/res/abi.json'), 'utf8')) as {
  methods: Record<string, { kind: string; params: Array<[string, string]>; allowApps?: string[] }>;
};

const ok = (result: unknown = null) => Promise.resolve({ index: 7, result, events: [] });

function transport(answers: Record<string, unknown> = {}) {
  const sent: Array<{ app: string; method: string; args: Record<string, unknown>; kind: 'call' | 'view' }> = [];
  const make = (kind: 'call' | 'view') =>
    vi.fn((app: string, method: string, args: unknown = {}) => {
      sent.push({ app, method, args: args as Record<string, unknown>, kind });
      return ok(answers[method] ?? null);
    });
  return { sent, client: { call: make('call'), view: make('view') } };
}

describe('the client covers the contract', () => {
  it('names exactly the contract methods, with the parameter names the ABI declares', () => {
    const fromAbi = Object.fromEntries(
      Object.entries(abi.methods)
        .filter(([name, m]) => m.kind !== 'init' && !APP_ONLY_METHODS.has(name))
        .map(([name, m]) => [name, m.params.map(([p]) => p)]),
    );
    expect(CONTRACT_METHODS).toEqual(fromAbi);
  });

  it('leaves out only the methods another workbook calls by xcall', () => {
    for (const name of APP_ONLY_METHODS) expect([name, abi.methods[name]?.allowApps]).toEqual([name, ['*']]);
  });

  it('reads with views and writes with calls, as the ABI says', () => {
    for (const [name, m] of Object.entries(abi.methods)) {
      if (m.kind === 'init' || APP_ONLY_METHODS.has(name)) continue;
      expect([name, CONTRACT_VIEWS.has(name)]).toEqual([name, m.kind === 'view']);
    }
  });

  it('has a method for each of them', () => {
    for (const name of Object.keys(CONTRACT_METHODS)) {
      expect(typeof (SpreadsheetClient.prototype as unknown as Record<string, unknown>)[name]).toBe('function');
    }
  });
});

describe('on the wire', () => {
  it('sends camelCase arguments, and 64-bit integers as decimal strings', async () => {
    const { sent, client } = transport();
    const ss = new SpreadsheetClient(client, 'app-1');
    await ss.renameSheet({ sheet_id: 's1', new_name: 'Q3' });
    await ss.addAttachment({ sheet_id: 's1', row_id: '0', col_id: '1', blob_id: 'b', name: 'a.pdf', size: 1234, mime: 'application/pdf' });
    await ss.getActivity({ since: 1_700_000_000_000_000_000, limit: 20 });
    expect(sent[0]).toMatchObject({ app: 'app-1', method: 'renameSheet', kind: 'call', args: { sheetId: 's1', newName: 'Q3' } });
    expect(sent[1].args.size).toBe('1234');
    expect(sent[2]).toMatchObject({ method: 'getActivity', kind: 'view', args: { since: '1700000000000000000', limit: 20 } });
  });

  it('answers with 64-bit integers as numbers, as v1 did', async () => {
    const { client } = transport({
      listSheets: [{ id: 's1', name: 'Sheet 1', position: 0, created_at: '1700000000000000000', linked_from: '' }],
    });
    const [sheet] = await new SpreadsheetClient(client, 'app-1').listSheets();
    expect(sheet.created_at).toBe(1_700_000_000_000_000_000);
    expect(sheet.position).toBe(0);
    expect(fromWire({ name: '42', size: '42' })).toEqual({ name: '42', size: 42 });
    expect(u64(12.7)).toBe('12');
  });

  it('runs `after` after every request, failed ones too', async () => {
    const after = vi.fn();
    const client = { call: vi.fn(() => Promise.reject(new Error('down'))), view: vi.fn(() => ok([])) };
    const ss = new SpreadsheetClient(client, 'app-1', after);
    await expect(ss.createSheet({ name: 'x' })).rejects.toThrow('down');
    await ss.listSheets();
    expect(after).toHaveBeenCalledTimes(2);
  });
});

describe('paged views', () => {
  it('follows `next` to the end and answers one list', async () => {
    const pages: Record<string, unknown> = {
      '': { items: [{ id: 'c1' }, { id: 'c2' }], next: 'k2' },
      k2: { items: [{ id: 'c3' }], next: null },
    };
    const sent: Array<Record<string, unknown>> = [];
    const client = {
      call: vi.fn(() => ok()),
      view: vi.fn((_app: string, _method: string, args: unknown = {}) => {
        const a = args as Record<string, unknown>;
        sent.push(a);
        return ok(pages[(a.cursor as string | undefined) ?? '']);
      }),
    };
    const comments = await new SpreadsheetClient(client, 'app-1').getComments();
    expect(comments.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(sent).toEqual([{ limit: 1000 }, { limit: 1000, cursor: 'k2' }]);
  });

  it('sorts members by arrival, as v1 answered', async () => {
    const { client } = transport({
      getMembers: { items: [{ id: 'a', joined_at: '20' }, { id: 'b', joined_at: '10' }], next: null },
    });
    const members = await new SpreadsheetClient(client, 'app-1').getMembers();
    expect(members.map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('reads every sheet: the stored cells, then each linked sheet', async () => {
    const view = vi.fn((_app: string, method: string, args: unknown = {}) => {
      const a = args as Record<string, unknown>;
      if (method === 'getAllCells') return ok({ items: [{ id: 's1|0|0' }], next: null });
      if (method === 'listSheets')
        return ok([{ id: 's1', linked_from: '' }, { id: 'link-x', linked_from: 'Finance' }]);
      if (method === 'getCells') return ok({ items: [{ id: `${String(a.sheetId)}|0|0` }], next: null });
      return ok();
    });
    const cells = await new SpreadsheetClient({ call: vi.fn(() => ok()), view }, 'app-1').getAllCells();
    expect(cells.map((c) => c.id)).toEqual(['s1|0|0', 'link-x|0|0']);
  });
});

describe('linked ranges, pushed by the contract', () => {
  it('only calls this workbook: the contract sends the xcalls', async () => {
    const { sent, client } = transport({ publishRange: 'pub-1' });
    const ss = new SpreadsheetClient(client, 'app-1');
    const id = await ss.publishRange({
      sheet_id: 's1', top_row_id: '0', left_col_id: '0', bottom_row_id: '0', right_col_id: '1', target_context: 'app-2', name: 'Totals',
    });
    await ss.pushPublication({ id });
    await ss.setCell({ sheet_id: 's1', row_id: '0', col_id: '0', raw_value: '1' });
    await ss.unpublish({ id });
    expect(sent.map((s) => [s.app, s.method, s.kind])).toEqual([
      ['app-1', 'publishRange', 'call'],
      ['app-1', 'pushPublication', 'call'],
      ['app-1', 'setCell', 'call'],
      ['app-1', 'unpublish', 'call'],
    ]);
  });
});
