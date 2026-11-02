import { describe, expect, it, vi } from 'vitest';
import abi from '../../../../logic/res/abi.json';
import { DOCS_METHODS, DocsClient, REGISTRY_METHODS, RegistryClient } from '../docsApi';

type Method = { kind: string; params: [string, string][] };
const methods = (abi as unknown as { methods: Record<string, Method> }).methods;

/** A transport that records what each adapter method sends. */
function recorder(result: unknown = null) {
  const sent: Array<{ kind: 'call' | 'view'; method: string; args: Record<string, unknown> }> = [];
  const transport = {
    call: vi.fn(async (_app: string, method: string, args: Record<string, unknown>) => {
      sent.push({ kind: 'call', method, args });
      return { index: 1, result, events: [] };
    }),
    view: vi.fn(async (_app: string, method: string, args: Record<string, unknown>) => {
      sent.push({ kind: 'view', method, args });
      return { index: 1, result };
    }),
  };
  return { transport, sent };
}

// Arguments for every adapter method, in the shapes the hooks pass them.
const SAMPLE: Record<string, Record<string, unknown>> = {
  createDoc: { title: 't' },
  getDoc: { id: 'd' },
  listDocs: { include_archived: true },
  searchDocs: { query: 'q', include_archived: false, cursor: null, limit: null },
  editDoc: { id: 'd', title: 't' },
  archiveDoc: { id: 'd' },
  unarchiveDoc: { id: 'd' },
  deleteDoc: { id: 'd' },
  addTag: { id: 'd', tag: 'x' },
  removeTag: { id: 'd', tag: 'x' },
  getTitle: { doc: 'd' },
  getTitleState: { doc: 'd' },
  titleApplyDelta: { doc: 'd', ops: [{ insert: 'a', attributes: null }] },
  titleApplyDeltaOn: { doc: 'd', base: '', ops: [], anchor: null },
  titleUndo: { doc: 'd', token: 't' },
  titleAnchorAt: { doc: 'd', position: 0, before: false },
  titleResolve: { doc: 'd', anchors: [] },
  insertBlock: { doc: 'd', after: null, kind: 'paragraph', depth: 0 },
  deleteBlock: { doc: 'd', block: 'b' },
  moveBlock: { doc: 'd', block: 'b', after: null },
  setKind: { doc: 'd', block: 'b', kind: 'heading' },
  setDepth: { doc: 'd', block: 'b', depth: 1 },
  setAttr: { doc: 'd', block: 'b', key: 'level', value: '1' },
  splitBlock: { doc: 'd', block: 'b', at: 1 },
  mergeBlocks: { doc: 'd', first: 'a', second: 'b' },
  applyDelta: { doc: 'd', block: 'b', ops: [] },
  applyDeltaOn: { doc: 'd', block: 'b', base: '', ops: [], anchor: null },
  undo: { doc: 'd', block: 'b', token: 't' },
  mark: { doc: 'd', block: 'b', start: 0, end: 1, key: 'bold', value: 'true' },
  getDocument: { doc: 'd' },
  getBlock: { doc: 'd', block: 'b' },
  getBlockDelta: { doc: 'd', block: 'b' },
  getText: { doc: 'd', block: 'b' },
  listBlocks: { doc: 'd' },
  getStateDigest: { doc: 'd' },
  passageCount: { doc: 'd', block: 'b', needle: 'x' },
  anchorAt: { doc: 'd', block: 'b', position: 0, before: true },
  resolveIds: { doc: 'd', block: 'b', anchors: [] },
  addComment: { doc_id: 'd', body: 'b' },
  listComments: { doc_id: 'd' },
  getComment: { id: 'c' },
  commentCount: {},
  commentSchemaVersion: { id: 'c' },
  editComment: { id: 'c', body: 'b' },
  deleteComment: { id: 'c' },
  getOwner: {},
  addManager: { member: 'm' },
  removeManager: { member: 'm' },
  listManagers: {},
  setTag: { key: 'k', name: 'n', color: '#000000' },
  deleteTag: { key: 'k' },
  listTags: {},
  saveView: { id: 'v', name: 'n', query: 'q' },
  deleteView: { id: 'v' },
  listViews: {},
};

describe('docsApi against the committed ABI', () => {
  it('covers every method of the component, and nothing else', () => {
    const ours = new Set<string>([...DOCS_METHODS, ...REGISTRY_METHODS]);
    const theirs = new Set(Object.keys(methods).filter((m) => methods[m].kind !== 'init'));
    expect([...ours].sort()).toEqual([...theirs].sort());
  });

  it.each([...DOCS_METHODS, ...REGISTRY_METHODS])(
    '%s sends exactly the ABI parameter names, as a view or a call as the ABI says',
    async (name) => {
      const { transport, sent } = recorder([]);
      const docs = new DocsClient(transport, 'app');
      const registry = new RegistryClient(transport, 'app');
      const target = (name in DocsClient.prototype ? docs : registry) as unknown as Record<
        string,
        (args?: unknown) => Promise<unknown>
      >;
      await target[name](SAMPLE[name]);
      expect(sent).toHaveLength(1);
      expect(sent[0].method).toBe(name);
      expect(Object.keys(sent[0].args).sort()).toEqual(methods[name].params.map(([p]) => p).sort());
      expect(sent[0].kind).toBe(methods[name].kind === 'view' ? 'view' : 'call');
    },
  );
});

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
    const doc = await new DocsClient(transport, 'app').getDoc({ id: 'd' });
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
    const out = await new DocsClient(transport, 'app').titleApplyDeltaOn({
      doc: 'd',
      base: '',
      ops: [{ insert: 'a', attributes: null }, { retain: 1, attributes: { bold: 'true' } }, { delete: 1 }],
      anchor: null,
    });
    expect(out.anchor_pos).toBe(1);
    expect(sent[0].args.ops).toEqual([{ insert: 'a' }, { retain: 1, attributes: { bold: 'true' } }, { delete: 1 }]);
  });

  it('reads counts and search totals from decimal strings', async () => {
    const { transport } = recorder({ hits: [], total: '12', nextCursor: 20 });
    const page = await new DocsClient(transport, 'app').searchDocs({
      query: 'q',
      include_archived: false,
      cursor: null,
      limit: null,
    });
    expect(page).toEqual({ hits: [], total: 12, next_cursor: 20 });
  });
});
