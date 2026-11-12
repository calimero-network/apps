import { describe, expect, it, vi } from 'vitest';

import { fromWire, u64, workbook, type Sheet } from './workbook';
import { withRoutes } from '@calimero-apps/connect/testing';

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

describe('on the wire', () => {
  it('sends camelCase arguments, and 64-bit integers as decimal strings', async () => {
    const { sent, client } = transport();
    const ss = workbook(client, 'app-1').sheets;
    await ss.renameSheet({ sheetId: 's1', newName: 'Q3' });
    await ss.addAttachment({ sheetId: 's1', rowId: '0', colId: '1', blobId: 'b', name: 'a.pdf', size: u64(1234), mime: 'application/pdf' });
    await ss.getActivity({ since: u64(1_700_000_000_000_000_000), limit: 20 });
    expect(sent[0]).toMatchObject({ app: 'app-1', method: 'renameSheet', kind: 'call', args: { sheetId: 's1', newName: 'Q3' } });
    expect(sent[1].args.size).toBe('1234');
    expect(sent[2]).toMatchObject({ method: 'getActivity', kind: 'view', args: { since: '1700000000000000000', limit: 20 } });
  });

  it('answers with 64-bit integers as numbers, as v1 did', async () => {
    const { client } = transport({
      listSheets: [{ id: 's1', name: 'Sheet 1', position: 0, created_at: '1700000000000000000', linked_from: '' }],
    });
    const [sheet] = (await workbook(client, 'app-1').sheets.listSheets()) as Sheet[];
    expect(sheet.created_at).toBe(1_700_000_000_000_000_000);
    expect(sheet.position).toBe(0);
    expect(fromWire({ name: '42', size: '42' })).toEqual({ name: '42', size: 42 });
    expect(u64(12.7)).toBe('12');
  });

  it('runs `after` after every request, failed ones too', async () => {
    const after = vi.fn();
    const client = withRoutes({ call: vi.fn(() => Promise.reject(new Error('down'))), view: vi.fn(() => ok([])) });
    const ss = workbook(client, 'app-1', after).sheets;
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
    const id = await workbook(client, 'app-1').publishRange({
      sheetId: 's1', topRowId: '0', leftColId: '0', bottomRowId: '0', rightColId: '1', targetContext: 'app-2', name: 'Totals',
    });
    expect(id).toBe('pub-1');
    expect(sent.map((s) => [s.app, s.method])).toEqual([['app-1', 'publishRange'], ['app-1', 'pushPublication'], ['app-2', 'receiveLink']]);
    expect(sent[2].args).toEqual({ fromContext: 'app-1', publicationId: 'pub-1', name: 'Totals', sourceName: 'Budget', rows: 1, cols: 2, values: ['1', '2'] });
  });

  it('relays after an edit to a linked sheet, and not after one to another sheet', async () => {
    const { sent, client } = transport({ getPublications: [PUB], pushPublication: PUSH });
    const wb = workbook(client, 'app-1');
    await wb.getPublications();
    await wb.sheets.setCell({ sheetId: 's2', rowId: '0', colId: '0', rawValue: '1' });
    await wb.sheets.setCell({ sheetId: 's1', rowId: '0', colId: '0', rawValue: '1' });
    await vi.waitFor(() => expect(sent.some((s) => s.method === 'receiveLink')).toBe(true));
    expect(sent.filter((s) => s.method === 'receiveLink')).toHaveLength(1);
  });

  it('never fails the edit when the relay does', async () => {
    const client = withRoutes({
      call: vi.fn((app: string) => (app === 'app-2' ? Promise.reject(new Error('not a member')) : ok('k'))),
      view: vi.fn((_app: string, method: string) => ok(method === 'getPublications' ? [PUB] : PUSH)),
    });
    await expect(workbook(client, 'app-1').sheets.setCell({ sheetId: 's1', rowId: '0', colId: '0', rawValue: '1' })).resolves.toBe('k');
  });

  it('pushes a link again on "push now"', async () => {
    const { sent, client } = transport({ pushPublication: PUSH });
    await workbook(client, 'app-1').relay('pub-1');
    expect(sent.map((s) => [s.app, s.method, s.kind])).toEqual([['app-1', 'pushPublication', 'view'], ['app-2', 'receiveLink', 'call']]);
  });

  it('takes the sheet out of the other workbook when a link stops', async () => {
    const { sent, client } = transport({ getPublications: [PUB] });
    await workbook(client, 'app-1').unpublish('pub-1');
    expect(sent.map((s) => [s.app, s.method])).toEqual([['app-1', 'getPublications'], ['app-1', 'unpublish'], ['app-2', 'dropLink']]);
    expect(sent[2].args).toEqual({ fromContext: 'app-1', publicationId: 'pub-1' });
  });
});
