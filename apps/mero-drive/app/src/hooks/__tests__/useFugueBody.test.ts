// The body binding, driven with a fake docs client so every assertion is the
// exact call the backend would receive.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { DocsClient } from '@/generated/docs/DocsClient';
import { useFugueBody } from '../useFugueBody';

let deliver: ((event: unknown) => void) | null = null;

vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: (_ids: string[], handler: (event: unknown) => void) => {
    deliver = handler;
  },
}));

const DOC = 'doc-1';
const CTX = 'ctx-1';

type FakeClient = Record<string, Mock>;

function fakeClient(): FakeClient {
  return {
    getDocument: vi.fn().mockResolvedValue([]),
    applyDelta: vi.fn().mockResolvedValue('tok-1'),
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

const row = (id: string, text: string, kind = 'paragraph') => ({
  id,
  kind,
  depth: 0,
  attrs: {},
  spans: text ? [{ text, attributes: {} }] : [],
});

const bnBlock = (id: string, text: string, type = 'paragraph') => ({
  id,
  type,
  props: {},
  content: text ? [{ type: 'text', text, styles: {} }] : [],
  children: [],
});

const blockEvent = (doc: string) => ({
  contextId: CTX,
  type: 'StateMutation',
  data: {
    events: [
      {
        kind: 'TextChanged',
        data: Array.from(
          new TextEncoder().encode(
            JSON.stringify({ doc, block: 'blk-1', ids: [] }),
          ),
        ),
      },
    ],
  },
});

const settle = async (ms = 600) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function mount(client: FakeClient) {
  return renderHook(() =>
    useFugueBody({
      client: client as unknown as DocsClient,
      docId: DOC,
      contextId: CTX,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  deliver = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useFugueBody', () => {
  it('reads the document and leaves the loading state', async () => {
    const client = fakeClient();
    client.getDocument.mockResolvedValue([row('blk-1', 'hello')]);
    const { result } = mount(client);
    await settle();
    expect(client.getDocument).toHaveBeenCalledWith({ doc: DOC });
    expect(result.current.loading).toBe(false);
    expect(JSON.parse(result.current.content!)).toEqual([
      {
        id: 'blk-1',
        type: 'paragraph',
        props: {},
        content: [{ type: 'text', text: 'hello', styles: {} }],
        children: [],
      },
    ]);
  });

  it('sends one delta for a typing burst, not one per keystroke', async () => {
    const client = fakeClient();
    client.getDocument.mockResolvedValue([row('blk-1', 'hello')]);
    const { result } = mount(client);
    await settle();

    act(() => {
      result.current.onContentChange(JSON.stringify([bnBlock('blk-1', 'hell')]));
      result.current.onContentChange(
        JSON.stringify([bnBlock('blk-1', 'hello!')]),
      );
    });
    await settle();
    expect(client.applyDelta).toHaveBeenCalledTimes(1);
    expect(client.applyDelta).toHaveBeenCalledWith({
      doc: DOC,
      block: 'blk-1',
      ops: [{ retain: 5 }, { insert: '!', attributes: {} }],
    });
  });

  it('resolves a new block id before the delta that fills it', async () => {
    const client = fakeClient();
    client.getDocument.mockResolvedValue([row('blk-1', 'hello')]);
    const { result } = mount(client);
    await settle();

    act(() =>
      result.current.onContentChange(
        JSON.stringify([bnBlock('blk-1', 'hello'), bnBlock('local-2', 'world')]),
      ),
    );
    await settle();
    expect(client.insertBlock).toHaveBeenCalledWith({
      doc: DOC,
      after: 'blk-1',
      kind: 'paragraph',
      depth: 0,
    });
    expect(client.applyDelta).toHaveBeenCalledWith({
      doc: DOC,
      block: 'blk-new',
      ops: [{ insert: 'world', attributes: {} }],
    });
  });

  it('keeps writing to the minted id on the next edit of a new block', async () => {
    const client = fakeClient();
    client.getDocument.mockResolvedValue([]);
    const { result } = mount(client);
    await settle();

    act(() =>
      result.current.onContentChange(JSON.stringify([bnBlock('local-1', 'a')])),
    );
    await settle();
    act(() =>
      result.current.onContentChange(JSON.stringify([bnBlock('local-1', 'ab')])),
    );
    await settle();
    expect(client.insertBlock).toHaveBeenCalledTimes(1);
    expect(client.applyDelta).toHaveBeenLastCalledWith({
      doc: DOC,
      block: 'blk-new',
      ops: [{ retain: 1 }, { insert: 'b', attributes: {} }],
    });
  });

  it('turns Enter in the middle of a block into one split', async () => {
    const client = fakeClient();
    client.getDocument.mockResolvedValue([row('blk-1', 'hello world')]);
    const { result } = mount(client);
    await settle();

    act(() =>
      result.current.onContentChange(
        JSON.stringify([
          bnBlock('blk-1', 'hello '),
          bnBlock('local-2', 'world'),
        ]),
      ),
    );
    await settle();
    expect(client.splitBlock).toHaveBeenCalledWith({
      doc: DOC,
      block: 'blk-1',
      at: 6,
    });
    expect(client.insertBlock).not.toHaveBeenCalled();
  });

  it('re-reads on a peer event and replaces the content', async () => {
    const client = fakeClient();
    client.getDocument.mockResolvedValue([row('blk-1', 'hello')]);
    const { result } = mount(client);
    await settle();
    const before = result.current.content;

    client.getDocument.mockResolvedValue([row('blk-1', 'hello there')]);
    act(() => deliver?.(blockEvent(DOC)));
    await settle();
    expect(result.current.content).not.toBe(before);
    expect(result.current.content).toContain('hello there');
  });

  it('leaves the content untouched when the re-read renders the same', async () => {
    const client = fakeClient();
    client.getDocument.mockResolvedValue([row('blk-1', 'hello')]);
    const { result } = mount(client);
    await settle();
    const before = result.current.content;

    act(() => deliver?.(blockEvent(DOC)));
    await settle();
    expect(result.current.content).toBe(before);
  });

  it('ignores an event for another document', async () => {
    const client = fakeClient();
    client.getDocument.mockResolvedValue([row('blk-1', 'hello')]);
    mount(client);
    await settle();
    client.getDocument.mockClear();
    act(() => deliver?.(blockEvent('doc-2')));
    await settle();
    expect(client.getDocument).not.toHaveBeenCalled();
  });

  it('undoes with the block and token the write returned', async () => {
    const client = fakeClient();
    client.getDocument.mockResolvedValue([row('blk-1', 'hello')]);
    const { result } = mount(client);
    await settle();
    act(() =>
      result.current.onContentChange(
        JSON.stringify([bnBlock('blk-1', 'hello!')]),
      ),
    );
    await settle();

    act(() => result.current.undo());
    await settle();
    expect(client.undo).toHaveBeenCalledWith({
      doc: DOC,
      block: 'blk-1',
      token: 'tok-1',
    });
  });

  it('reports a failed write and re-reads rather than diverging silently', async () => {
    const client = fakeClient();
    client.getDocument.mockResolvedValue([row('blk-1', 'hello')]);
    client.applyDelta.mockRejectedValue(new Error('offline'));
    const { result } = mount(client);
    await settle();
    client.getDocument.mockClear();

    act(() =>
      result.current.onContentChange(
        JSON.stringify([bnBlock('blk-1', 'hello!')]),
      ),
    );
    await settle();
    expect(result.current.error?.message).toBe('offline');
    expect(client.getDocument).toHaveBeenCalled();
  });

  it('sends an edit still inside the debounce window when the editor closes', async () => {
    const client = fakeClient();
    client.getDocument.mockResolvedValue([row('blk-1', 'hello')]);
    const { result, unmount } = mount(client);
    await settle();

    act(() =>
      result.current.onContentChange(
        JSON.stringify([bnBlock('blk-1', 'hello!')]),
      ),
    );
    unmount();
    await settle();
    expect(client.applyDelta).toHaveBeenCalledWith({
      doc: DOC,
      block: 'blk-1',
      ops: [{ retain: 5 }, { insert: '!', attributes: {} }],
    });
  });
});
