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
  undo?: () => boolean;
  redo?: () => boolean;

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

  replaceBlocks(remove: string[], insert: Record<string, unknown>[]): void {
    const at = this.document.findIndex((b) => remove.includes(b.id));
    this.document = this.document.filter((b) => !remove.includes(b.id));
    this.document.splice(at, 0, ...(structuredClone(insert) as unknown as BnBlock[]));
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

const applied = (text: string, token = 'tok-1', anchor: string | null = null, anchor_pos: number | null = null) => ({
  applied: true,
  token,
  spans: spans(text),
  anchor,
  anchor_pos,
});
const refused = (text: string, anchor: string | null = null, anchor_pos: number | null = null) => ({
  applied: false,
  token: null,
  spans: spans(text),
  anchor,
  anchor_pos,
});

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
      anchor: null,
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
      anchor: null,
    });
  });

  it('keeps a pending keystroke after its own letter when peers typed on both sides of it', async () => {
    const client = fakeClient([row('blk-1', 'Shared:a')]);
    client.applyDeltaOn
      .mockResolvedValueOnce(refused('Shared:bac'))
      .mockResolvedValueOnce(applied('Shared:ba1c'));
    const editor = new FakeEditor();
    await mount(client, editor);

    editor.type('blk-1', 'Shared:a1');
    await settle();

    expect(client.applyDeltaOn).toHaveBeenLastCalledWith({
      doc: DOC,
      block: 'blk-1',
      base: 'Shared:bac',
      ops: [{ retain: 9 }, { insert: '1', attributes: {} }],
      anchor: null,
    });
    expect(editor.textOf('blk-1')).toBe('Shared:ba1c');
  });

  it('puts a refused keystroke right after its writer\'s own last letter, not after an identical one', async () => {
    const client = fakeClient([row('blk-1', 'Shared:')]);
    client.applyDeltaOn
      .mockResolvedValueOnce(applied('Shared:a', 'tok-a', 'anc-a', 8))
      // Peers typed `b3` before the `a` and `3c3` in its gap; the `a` is at 9.
      .mockResolvedValueOnce(refused('Shared:b3a3c3', 'anc-a', 10))
      .mockResolvedValueOnce(applied('Shared:b3a33c3', 'tok-b', 'anc-3', 11));
    const editor = new FakeEditor();
    await mount(client, editor);

    editor.type('blk-1', 'Shared:a');
    await settle();
    editor.type('blk-1', 'Shared:a3');
    await settle();

    expect(client.applyDeltaOn).toHaveBeenNthCalledWith(2, {
      doc: DOC,
      block: 'blk-1',
      base: 'Shared:a',
      ops: [{ retain: 8 }, { insert: '3', attributes: {} }],
      anchor: 'anc-a',
    });
    expect(client.applyDeltaOn).toHaveBeenLastCalledWith({
      doc: DOC,
      block: 'blk-1',
      base: 'Shared:b3a3c3',
      ops: [{ retain: 10 }, { insert: '3', attributes: {} }],
      anchor: 'anc-a',
    });
    expect(editor.textOf('blk-1')).toBe('Shared:b3a33c3');
  });

  it('keeps sending at its anchor while the keystrokes stay at it', async () => {
    const client = fakeClient([row('blk-1', 'b')]);
    client.applyDeltaOn
      .mockResolvedValueOnce(applied('ab', 'tok-a', 'anc-a', 1))
      .mockResolvedValueOnce(applied('abb', 'tok-b', 'anc-b', 2));
    const editor = new FakeEditor();
    await mount(client, editor);

    editor.type('blk-1', 'ab');
    await settle();
    editor.type('blk-1', 'abb');
    await settle();

    // A plain diff reads `abb` as a `b` after the peer's `b`, at 2.
    expect(client.applyDeltaOn).toHaveBeenLastCalledWith({
      doc: DOC,
      block: 'blk-1',
      base: 'ab',
      ops: [{ retain: 1 }, { insert: 'b', attributes: {} }],
      anchor: 'anc-a',
    });
  });

  it('moves typing to where the node puts its anchor when a peer change made the local position drift', async () => {
    const client = fakeClient([row('blk-1', 'ba1')]);
    client.applyDeltaOn
      .mockResolvedValueOnce(applied('b1a1', 'tok-a', 'anc-1', 2))
      .mockResolvedValueOnce(refused('cb1a1a1', 'anc-1', 3))
      .mockResolvedValueOnce(applied('cb1Xa1a1'));
    const editor = new FakeEditor();
    await mount(client, editor);
    editor.type('blk-1', 'b1a1');
    await settle();
    client.getDocument.mockResolvedValue([row('blk-1', 'cb1a1a1')]);
    act(() => deliver?.(peerEvent(DOC)));
    await settle();

    editor.type('blk-1', 'cb1a1Xa1');
    await settle();

    expect(client.applyDeltaOn).toHaveBeenLastCalledWith({
      doc: DOC,
      block: 'blk-1',
      base: 'cb1a1a1',
      ops: [{ retain: 3 }, { insert: 'X', attributes: {} }],
      anchor: 'anc-1',
    });
    expect(editor.textOf('blk-1')).toBe('cb1Xa1a1');
  });

  it('forgets its anchors once a write changes the block structure', async () => {
    const client = fakeClient([row('blk-1', 'b')]);
    client.applyDeltaOn.mockResolvedValueOnce(applied('ab', 'tok-a', 'anc-a', 1));
    const editor = new FakeEditor();
    await mount(client, editor);
    editor.type('blk-1', 'ab');
    await settle();

    client.applyDeltaOn.mockResolvedValue(applied('abb'));
    editor.document.splice(1, 0, bn('new-1', ''));
    editor.type('blk-1', 'abb');
    await settle();

    expect(client.applyDeltaOn).toHaveBeenLastCalledWith({
      doc: DOC,
      block: 'blk-1',
      base: 'ab',
      ops: [{ retain: 2 }, { insert: 'b', attributes: {} }],
      anchor: null,
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
      anchor: null,
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
      anchor: null,
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
      anchor: null,
    });
  });

  it('replaces the placeholder block when a peer writes the first block of an empty document', async () => {
    const client = fakeClient([]);
    const editor = new FakeEditor();
    await mount(client, editor);
    editor.document = [bn('placeholder', '')];

    client.getDocument.mockResolvedValue([row('blk-1', 'The fox.')]);
    act(() => deliver?.(peerEvent(DOC)));
    await settle();
    await settle();

    expect(editor.document.map((b) => b.id)).toEqual(['blk-1']);
    expect(editor.textOf('blk-1')).toBe('The fox.');
    expect(client.insertBlock).not.toHaveBeenCalled();
  });

  it('keeps a peer\'s text that lands while this window changes that block\'s kind', async () => {
    const client = fakeClient([row('blk-1', 'one'), row('blk-2', 'two')]);
    const editor = new FakeEditor();
    await mount(client, editor);

    client.getDocument.mockResolvedValue([row('blk-1', 'one'), row('blk-2', 'two!', 'heading')]);
    editor.updateBlock('blk-2', { type: 'heading' });
    await settle();
    await settle();

    expect(client.setKind).toHaveBeenCalledWith({ doc: DOC, block: 'blk-2', kind: 'heading' });
    expect(editor.textOf('blk-2')).toBe('two!');
    expect(client.applyDeltaOn).not.toHaveBeenCalled();
  });

  it('undoes and redoes through the editor history, not per write', async () => {
    const client = fakeClient([row('blk-1', 'a')]);
    const editor = new FakeEditor();
    editor.undo = vi.fn().mockReturnValue(true);
    editor.redo = vi.fn().mockReturnValue(true);
    const { result } = await mount(client, editor);

    act(() => result.current.undo());
    act(() => result.current.redo());

    expect(editor.undo).toHaveBeenCalledTimes(1);
    expect(editor.redo).toHaveBeenCalledTimes(1);
    expect(client.undo).not.toHaveBeenCalled();
  });

  it("replaces only the blocks a peer's move touched, so the rest keep their undo history", async () => {
    const rows = [row('blk-1', 'Alpha'), row('blk-2', 'Bravo'), row('blk-3', 'Charlie'), row('blk-4', 'Delta')];
    const client = fakeClient(rows);
    const editor = new FakeEditor();
    await mount(client, editor);
    const replace = vi.spyOn(editor, 'replaceBlocks');

    client.getDocument.mockResolvedValue([rows[0], rows[1], rows[3], rows[2]]);
    act(() => deliver?.(peerEvent(DOC)));
    await settle();

    expect(editor.document.map((b) => b.id)).toEqual(['blk-1', 'blk-2', 'blk-4', 'blk-3']);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0]).toEqual(['blk-3', 'blk-4']);
  });

  it("inserts a peer's nested block beside the untouched ones instead of rebuilding the document", async () => {
    const rows = [row('blk-1', 'Alpha'), row('blk-2', 'Bravo')];
    const client = fakeClient(rows);
    const editor = new FakeEditor();
    await mount(client, editor);
    const replace = vi.spyOn(editor, 'replaceBlocks');

    client.getDocument.mockResolvedValue([rows[0], rows[1], { ...row('blk-3', 'Echo'), depth: 1 }]);
    act(() => deliver?.(peerEvent(DOC)));
    await settle();

    expect(editor.document.map((b) => b.id)).toEqual(['blk-1', 'blk-2']);
    expect(editor.document[1]).toMatchObject({ id: 'blk-2', children: [{ id: 'blk-3' }] });
    expect(replace.mock.calls.map(([remove]) => remove)).toEqual([['blk-2']]);
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
      anchor: null,
    });
  });
});
