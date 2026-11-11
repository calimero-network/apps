import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { CONTRACT_METHODS, CONTRACT_VIEWS, SpreadsheetClient, fromWire, u64 } from './SpreadsheetClient';
import { withRoutes } from '@calimero-apps/connect/testing';

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, '../../../../logic/res/abi.json'), 'utf8')) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

const ok = (result: unknown = null) => Promise.resolve({ index: 7, result, events: [] });

function transport(answers: Record<string, unknown> = {}) {
  const sent: Array<{ app: string; method: string; args: Record<string, unknown>; kind: 'call' | 'view' }> = [];
  const make = (kind: 'call' | 'view') =>
    vi.fn((app: string, method: string, args: unknown = {}) => {
      sent.push({ app, method, args: args as Record<string, unknown>, kind });
      return ok(answers[method] ?? null);
    });
  return { sent, client: withRoutes({ call: make('call'), view: make('view') }) };
}

describe('the client covers the contract', () => {
  it('names exactly the contract methods, with the parameter names the ABI declares', () => {
    const fromAbi = Object.fromEntries(
      Object.entries(abi.methods)
        .filter(([, m]) => m.kind !== 'init')
        .map(([name, m]) => [name, m.params.map(([p]) => p)]),
    );
    expect(CONTRACT_METHODS).toEqual(fromAbi);
  });

  it('reads with views and writes with calls, as the ABI says', () => {
    for (const [name, m] of Object.entries(abi.methods)) {
      if (m.kind === 'init') continue;
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
    const client = withRoutes({ call: vi.fn(() => Promise.reject(new Error('down'))), view: vi.fn(() => ok([])) });
    const ss = new SpreadsheetClient(client, 'app-1', after);
    await expect(ss.createSheet({ name: 'x' })).rejects.toThrow('down');
    await ss.listSheets();
    expect(after).toHaveBeenCalledTimes(2);
  });
});

describe('linked ranges, relayed by the browser', () => {
  const PUSH = { publication_id: 'pub-1', target_context: 'app-2', name: 'Totals', source_name: 'Budget', rows: 1, cols: 2, values: ['1', '2'] };
  const PUB = { id: 'pub-1', sheet_id: 's1', top_row_id: '0', left_col_id: '0', bottom_row_id: '0', right_col_id: '1', target_context: 'app-2', name: 'Totals', created_by: 'me' };

  it('hands a new link its first values', async () => {
    const { sent, client } = transport({ publishRange: 'pub-1', pushPublication: PUSH });
    const id = await new SpreadsheetClient(client, 'app-1').publishRange({
      sheet_id: 's1', top_row_id: '0', left_col_id: '0', bottom_row_id: '0', right_col_id: '1', target_context: 'app-2', name: 'Totals',
    });
    expect(id).toBe('pub-1');
    expect(sent.map((s) => [s.app, s.method])).toEqual([['app-1', 'publishRange'], ['app-1', 'pushPublication'], ['app-2', 'receiveLink']]);
    expect(sent[2].args).toEqual({ fromContext: 'app-1', publicationId: 'pub-1', name: 'Totals', sourceName: 'Budget', rows: 1, cols: 2, values: ['1', '2'] });
  });

  it('relays after an edit to a linked sheet, and not after one to another sheet', async () => {
    const { sent, client } = transport({ getPublications: [PUB], pushPublication: PUSH });
    const ss = new SpreadsheetClient(client, 'app-1');
    await ss.getPublications();
    await ss.setCell({ sheet_id: 's2', row_id: '0', col_id: '0', raw_value: '1' });
    await ss.setCell({ sheet_id: 's1', row_id: '0', col_id: '0', raw_value: '1' });
    await vi.waitFor(() => expect(sent.some((s) => s.method === 'receiveLink')).toBe(true));
    expect(sent.filter((s) => s.method === 'receiveLink')).toHaveLength(1);
  });

  it('never fails the edit when the relay does', async () => {
    const client = withRoutes({
      call: vi.fn((app: string) => (app === 'app-2' ? Promise.reject(new Error('not a member')) : ok('k'))),
      view: vi.fn((_app: string, method: string) => ok(method === 'getPublications' ? [PUB] : PUSH)),
    });
    await expect(new SpreadsheetClient(client, 'app-1').setCell({ sheet_id: 's1', row_id: '0', col_id: '0', raw_value: '1' })).resolves.toBe('k');
  });

  it('takes the sheet out of the other workbook when a link stops', async () => {
    const { sent, client } = transport({ getPublications: [PUB] });
    await new SpreadsheetClient(client, 'app-1').unpublish({ id: 'pub-1' });
    expect(sent.map((s) => [s.app, s.method])).toEqual([['app-1', 'getPublications'], ['app-1', 'unpublish'], ['app-2', 'dropLink']]);
    expect(sent[2].args).toEqual({ fromContext: 'app-1', publicationId: 'pub-1' });
  });
});
