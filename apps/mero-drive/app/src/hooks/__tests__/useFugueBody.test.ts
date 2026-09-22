// The body binding against a fake editor and a fake node, so every assertion
// is the exact call the node receives or the exact text the editor holds.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { DocsClient } from '@/generated/docs/DocsClient';
import { useFugueBody, type BodyEditor } from '../useFugueBody';

let deliver: ((event: unknown) => void) | null = null;

vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: (_ids: string[], handler: (event: unknown) => void) => {
    deliver = handler;
  },
}));

const DOC = 'doc-1';
const CTX = 'ctx-1';

interface BnBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: { type: 'text'; text: string; styles: Record<string, unknown> }[];
  children: BnBlock[];
}

const bn = (id: string, text: string, type = 'paragraph'): BnBlock => ({
  id,
  type,
  props: {},
  content: text ? [{ type: 'text', text, styles: {} }] : [],
  children: [],
});

const row = (id: string, text: string, kind = 'paragraph', attrs = {}) => ({
  id,
  kind,
  depth: 0,
  attrs,
  spans: text ? [{ text }] : [],
});

const spans = (text: string) => (text ? [{ text }] : []);

/** An in-memory BlockNote stand-in that reports every change like the shell does. */
class FakeEditor implements BodyEditor {
  document: BnBlock[] = [];
  readonly prosemirrorView = undefined;
  onChange: () => void = () => {};

  textOf(id: string): string {
    const block = this.document.find((b) => b.id === id);
    return block ? block.content.map((c) => c.text).join('') : '';
  }

  type(id: string, text: string): void {
    const block = this.document.find((b) => b.id === id);
    if (block) block.content = text ? [{ type: 'text', text, styles: {} }] : [];
    this.onChange();
  }

  updateBlock(id: string, update: Record<string, unknown>): void {
    const block = this.document.find((b) => b.id === id);
    if (!block) return;
    if (update.content) block.content = update.content as BnBlock['content'];
    if (update.type) block.type = update.type as string;
    if (update.props) block.props = { ...(update.props as Record<string, unknown>) };
    this.onChange();
  }

  insertBlocks(blocks: Record<string, unknown>[], reference: string, placement: 'before' | 'after'): void {
    const at = this.document.findIndex((b) => b.id === reference);
    const index = placement === 'after' ? at + 1 : at;
    this.document.splice(index, 0, ...(blocks as unknown as BnBlock[]));
    this.onChange();
  }

  removeBlocks(ids: string[]): void {
    this.document = this.document.filter((b) => !ids.includes(b.id));
    this.onChange();
  }

  replaceBlocks(_remove: string[], insert: Record<string, unknown>[]): void {
    this.document = structuredClone(insert) as unknown as BnBlock[];
    this.onChange();
  }
}

type FakeClient = Record<string, Mock>;

function fakeClient(document: ReturnType<typeof row>[]): FakeClient {
  return {
    getDocument: vi.fn().mockResolvedValue(document),
    applyDeltaOn: vi.fn(),
    insertBlock: vi.fn().mockResolvedValue('blk-new'),
    splitBlock: vi.fn().mockResolvedValue('blk-split'),
    deleteBlock: vi.fn().mockResolvedValue(undefined),
    mergeBlocks: vi.fn().mockResolvedValue(undefined),
    moveBlock: vi.fn().mockResolvedValue(undefined),
    setKind: vi.fn().mockResolvedValue(undefined),
    setDepth: vi.fn().mockResolvedValue(undefined),
    setAttr: vi.fn().mockResolvedValue(undefined),
    undo: vi.fn().mockResolvedValue('redo-1'),
  };
}

const applied = (text: string, token = 'tok-1') => ({ applied: true, token, spans: spans(text) });
const refused = (text: string) => ({ applied: false, token: null, spans: spans(text) });

const peerEvent = (doc: string) => ({
  contextId: CTX,
  type: 'StateMutation',
  data: {
    events: [
      {
        kind: 'TextChanged',
        data: Array.from(new TextEncoder().encode(JSON.stringify({ doc, block: 'blk-1', ids: [] }))),
      },
    ],
  },
});

const settle = async (ms = 400) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Mounts the hook and applies the first load the way EditorShell would. */
async function mount(client: FakeClient, editor: FakeEditor) {
  const view = renderHook(() =>
    useFugueBody({
      client: client as unknown as DocsClient,
      docId: DOC,
      contextId: CTX,
      editor,
    }),
  );
  await settle();
  editor.document = JSON.parse(view.result.current.content ?? '[]');
  editor.onChange = () => view.result.current.onContentChange('');
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  deliver = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useFugueBody', () => {
  it('loads the document once and leaves the loading state', async () => {
    const editor = new FakeEditor();
    const { result } = await mount(fakeClient([row('blk-1', 'hello')]), editor);
    expect(result.current.loading).toBe(false);
    expect(editor.textOf('blk-1')).toBe('hello');
  });

  it('sends a typing burst as one delta guarded by the text it was diffed against', async () => {
    const client = fakeClient([row('blk-1', 'The fox.')]);
    client.applyDeltaOn.mockResolvedValue(applied('The fox. ab'));
    const editor = new FakeEditor();
    await mount(client, editor);

    editor.type('blk-1', 'The fox. a');
    editor.type('blk-1', 'The fox. ab');
    await settle();

    expect(client.applyDeltaOn).toHaveBeenCalledTimes(1);
    expect(client.applyDeltaOn).toHaveBeenCalledWith({
      doc: DOC,
      block: 'blk-1',
      base: 'The fox.',
      ops: [{ retain: 8 }, { insert: ' ab', attributes: {} }],
    });
    await settle();
    expect(client.applyDeltaOn).toHaveBeenCalledTimes(1);
  });

  it('rebases a refused write onto the peer text and resends it', async () => {
    const client = fakeClient([row('blk-1', 'The fox.')]);
    client.applyDeltaOn
      .mockResolvedValueOnce(refused('bob The fox.'))
      .mockResolvedValueOnce(applied('bob The fox. ab'));
    const editor = new FakeEditor();
    await mount(client, editor);

    editor.type('blk-1', 'The fox. ab');
    await settle();

    expect(editor.textOf('blk-1')).toBe('bob The fox. ab');
    expect(client.applyDeltaOn).toHaveBeenCalledTimes(2);
    expect(client.applyDeltaOn).toHaveBeenLastCalledWith({
      doc: DOC,
      block: 'blk-1',
      base: 'bob The fox.',
      ops: [{ retain: 12 }, { insert: ' ab', attributes: {} }],
    });
  });

  it('folds a peer edit into the block without losing a keystroke typed meanwhile', async () => {
    const client = fakeClient([row('blk-1', 'The fox.')]);
    client.applyDeltaOn.mockResolvedValue(applied('bob The fox. ab'));
    const editor = new FakeEditor();
    await mount(client, editor);

    const read = deferred<unknown>();
    client.getDocument.mockReturnValueOnce(read.promise);
    act(() => deliver?.(peerEvent(DOC)));
    await settle(100);
    editor.type('blk-1', 'The fox. ab');
    await act(async () => read.resolve([row('blk-1', 'bob The fox.')]));
    await settle();

    expect(editor.textOf('blk-1')).toBe('bob The fox. ab');
    expect(client.applyDeltaOn).toHaveBeenCalledWith({
      doc: DOC,
      block: 'blk-1',
      base: 'bob The fox.',
      ops: [{ retain: 12 }, { insert: ' ab', attributes: {} }],
    });
  });

  it('writes a new block to the id the node minted, and never mints it twice', async () => {
    const client = fakeClient([row('blk-1', 'a')]);
    client.applyDeltaOn.mockResolvedValue(applied('hi'));
    const editor = new FakeEditor();
    await mount(client, editor);

    client.getDocument.mockResolvedValue([row('blk-1', 'a'), row('blk-new', 'hi')]);
    editor.insertBlocks([bn('local-2', 'hi') as unknown as Record<string, unknown>], 'blk-1', 'after');
    await settle();
    await settle();

    expect(client.insertBlock).toHaveBeenCalledTimes(1);
    expect(client.insertBlock).toHaveBeenCalledWith({ doc: DOC, after: 'blk-1', kind: 'paragraph', depth: 0 });
    expect(client.applyDeltaOn).toHaveBeenCalledWith({
      doc: DOC,
      block: 'blk-new',
      base: '',
      ops: [{ insert: 'hi', attributes: {} }],
    });
    expect(client.applyDeltaOn).toHaveBeenCalledTimes(1);
  });

  it('turns Enter mid-block into one split and never resends it', async () => {
    const client = fakeClient([row('blk-1', 'hello world')]);
    const editor = new FakeEditor();
    await mount(client, editor);

    client.getDocument.mockResolvedValue([row('blk-1', 'hello '), row('blk-split', 'world')]);
    editor.document = [bn('blk-1', 'hello '), bn('local-2', 'world')];
    editor.onChange();
    await settle();
    await settle();

    expect(client.splitBlock).toHaveBeenCalledTimes(1);
    expect(client.splitBlock).toHaveBeenCalledWith({ doc: DOC, block: 'blk-1', at: 6 });
    expect(client.applyDeltaOn).not.toHaveBeenCalled();
  });

  it('takes a peer heading change into that block without reverting it or a pending edit', async () => {
    const client = fakeClient([row('blk-1', 'one'), row('blk-2', 'two')]);
    client.applyDeltaOn.mockResolvedValue(applied('two!'));
    const editor = new FakeEditor();
    await mount(client, editor);

    const read = deferred<unknown>();
    client.getDocument.mockReturnValueOnce(read.promise);
    act(() => deliver?.(peerEvent(DOC)));
    await settle(100);
    editor.type('blk-2', 'two!');
    await act(async () => read.resolve([row('blk-1', 'one', 'heading', { level: '1' }), row('blk-2', 'two')]));
    await settle();

    expect(editor.document.find((b) => b.id === 'blk-1')?.type).toBe('heading');
    expect(editor.textOf('blk-2')).toBe('two!');
    expect(client.setKind).not.toHaveBeenCalled();
    expect(client.applyDeltaOn).toHaveBeenCalledWith({
      doc: DOC,
      block: 'blk-2',
      base: 'two',
      ops: [{ retain: 3 }, { insert: '!', attributes: {} }],
    });
  });

  it('undoes with the block and token the write returned', async () => {
    const client = fakeClient([row('blk-1', 'a')]);
    client.applyDeltaOn.mockResolvedValue(applied('ab', 'tok-7'));
    const editor = new FakeEditor();
    const { result } = await mount(client, editor);

    editor.type('blk-1', 'ab');
    await settle();
    act(() => result.current.undo());
    await settle();

    expect(client.undo).toHaveBeenCalledWith({ doc: DOC, block: 'blk-1', token: 'tok-7' });
  });

  it('ignores an event for another document', async () => {
    const client = fakeClient([row('blk-1', 'a')]);
    await mount(client, new FakeEditor());
    const reads = client.getDocument.mock.calls.length;
    act(() => deliver?.(peerEvent('other-doc')));
    await settle();
    expect(client.getDocument).toHaveBeenCalledTimes(reads);
  });

  it('sends an edit still inside the debounce window when the editor closes', async () => {
    const client = fakeClient([row('blk-1', 'The fox.')]);
    client.applyDeltaOn.mockResolvedValue(applied('The fox. ab'));
    const editor = new FakeEditor();
    const { unmount } = await mount(client, editor);

    editor.type('blk-1', 'The fox. ab');
    unmount();
    await settle();

    expect(client.applyDeltaOn).toHaveBeenCalledWith({
      doc: DOC,
      block: 'blk-1',
      base: 'The fox.',
      ops: [{ retain: 8 }, { insert: ' ab', attributes: {} }],
    });
  });
});
