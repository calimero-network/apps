import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { CALLS, CONFIRMED, VIEWS, allPages, meroSign } from './meroSign';

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, '../../../logic/res/abi.json'), 'utf8')) as {
  methods: Record<string, { kind: string; confirm: boolean; params: Array<[string, string]> }>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

describe('the client covers the contract', () => {
  it('calls exactly the contract calls, and views exactly its views', () => {
    expect([...CALLS].sort()).toEqual(byKind('call'));
    expect([...VIEWS].sort()).toEqual(byKind('view'));
    expect(byKind('init')).toEqual(['init']);
  });

  it('confirms exactly the methods the contract marks `confirm`', () => {
    const confirm = Object.entries(abi.methods)
      .filter(([, m]) => m.confirm)
      .map(([n]) => n);
    expect([...CONFIRMED].sort()).toEqual(confirm.sort());
  });

  it('sends each method the parameter names the ABI declares', async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      return Promise.resolve({ index: 1, result: null, events: [] });
    };
    const c = meroSign(
      { call: vi.fn(record), view: vi.fn(record), callConfirmed: vi.fn(record) },
      'app-1',
      () => ({}) as never,
    );
    // Every optional parameter given, so every name is sent.
    await Promise.all([
      c.setup(false, 'n'),
      c.isDefaultPrivateContext(),
      c.createSignature('n', 'b', '1'),
      c.deleteSignature('1'),
      c.listSignatures('cur', 10),
      c.joinSharedContext('a', 'n'),
      c.leaveSharedContext('a'),
      c.listJoinedContexts('cur', 10),
      c.getContextDetails(),
      c.whoami(),
      c.listParticipants(),
      c.getUserPermission('u'),
      c.getContextId(),
      c.registerSelfAsParticipant(),
      c.addParticipant('u', 'Sign'),
      c.removeParticipant('u'),
      c.setParticipantPermission('u', 'Read'),
      c.uploadDocument({
        name: 'n',
        hash: 'h',
        pdfBlobIdStr: 'b',
        fileSize: '1',
        embeddings: [1],
        extractedText: 't',
        chunks: [],
      }),
      c.deleteDocument('d'),
      c.listDocuments('cur', 10),
      c.setConsent('d'),
      c.hasConsented('u', 'd'),
      c.signDocument({ documentId: 'd', baseHash: 'h', pdfBlobIdStr: 'b', fileSize: '1', newHash: 'h' }),
      c.getDocumentStatus('d'),
      c.getDocumentSignatures('d'),
      c.markParticipantSigned('d'),
      c.documentDownload('d'),
      c.searchDocumentByEmbedding([1], 'd'),
    ]);
    // getContextDetails' optional `contextIdStr` is not sent: the app answers for itself.
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === 'init') continue;
      const want = method.params
        .map(([p]) => p)
        .filter((p) => !(name === 'getContextDetails' && p === 'contextIdStr'))
        .sort();
      expect(sent.get(name), name).toEqual(want);
    }
  });
});

describe('meroSign', () => {
  it('routes calls through the log, views to a node, and signing through a passkey step-up', async () => {
    const call = vi.fn().mockResolvedValue({ index: 3, result: 'doc_1', events: [] });
    const view = vi.fn().mockResolvedValue({ index: 3, result: 'Sign' });
    const callConfirmed = vi.fn().mockResolvedValue({ index: 4, result: null, events: [] });
    const passkey = { id: 'pk' };
    const after = vi.fn();
    const c = meroSign({ call, view, callConfirmed }, 'app-1', () => passkey as never, after);

    expect(await c.uploadDocument({ name: 'n', hash: 'h', pdfBlobIdStr: 'h', fileSize: '3' })).toBe('doc_1');
    expect(call).toHaveBeenCalledWith('app-1', 'uploadDocument', {
      name: 'n',
      hash: 'h',
      pdfBlobIdStr: 'h',
      fileSize: '3',
    });
    expect(await c.getUserPermission('bob')).toBe('Sign');
    expect(view).toHaveBeenCalledWith('app-1', 'getUserPermission', { userIdStr: 'bob' });
    await c.signDocument({ documentId: 'd', baseHash: 'a', pdfBlobIdStr: 'b', fileSize: '1', newHash: 'b' });
    expect(callConfirmed).toHaveBeenCalledWith(
      'app-1',
      'signDocument',
      { documentId: 'd', baseHash: 'a', pdfBlobIdStr: 'b', fileSize: '1', newHash: 'b' },
      passkey,
    );
    expect(call).not.toHaveBeenCalledWith('app-1', 'signDocument', expect.anything());
    expect(after).toHaveBeenCalledTimes(3);
  });

  it('leaves out a page cursor it does not have', async () => {
    const view = vi.fn().mockResolvedValue({ index: 1, result: { items: [], next: null } });
    const c = meroSign({ call: vi.fn(), view, callConfirmed: vi.fn() }, 'a', () => ({}) as never);
    await c.listDocuments(null, 1000);
    expect(view).toHaveBeenCalledWith('a', 'listDocuments', { limit: 1000 });
  });

  it('runs `after` when a request fails too', async () => {
    const after = vi.fn();
    const c = meroSign(
      { call: vi.fn(), view: vi.fn().mockRejectedValue(new Error('boom')), callConfirmed: vi.fn() },
      'a',
      () => ({}) as never,
      after,
    );
    await expect(c.whoami()).rejects.toThrow('boom');
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe('allPages', () => {
  it('follows `next` until the last page', async () => {
    const pages: Record<string, { items: number[]; next: string | null }> = {
      start: { items: [1, 2], next: 'p2' },
      p2: { items: [3], next: null },
    };
    const read = vi.fn((cursor: string | null) => Promise.resolve(pages[cursor ?? 'start']));
    expect(await allPages(read)).toEqual([1, 2, 3]);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
