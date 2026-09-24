// Both directions of the body caret, driven with a fake editor whose document
// has fixed positions, so every assertion is an exact position or call.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { DocsClient } from '@/generated/docs/DocsClient';
import type { DocNode } from '@/components/editor/presence/geometry';
import type { DocPresence } from '@/lib/rich/presence';
import { useBodyCursors, type CursorEditor } from '../useBodyCursors';

const dispatched: unknown[] = [];

const lastDrawn = () => dispatched[dispatched.length - 1];

vi.mock('@/components/editor/presence/presencePlugin', () => ({
  setPresenceDecorations: (_view: unknown, specs: unknown) =>
    dispatched.push(specs),
}));

const DOC = 'doc-1';

function textNode(text: string): DocNode {
  return {
    isTextblock: false,
    isText: true,
    text,
    textContent: text,
    nodeSize: text.length,
    childCount: 0,
    child: () => {
      throw new Error('no children');
    },
    descendants: () => {},
  };
}

// doc > container(blk-1) > paragraph > "hello world"
const doc: DocNode = {
  isTextblock: false,
  isText: false,
  textContent: 'hello world',
  nodeSize: 17,
  childCount: 1,
  child: () => {
    throw new Error('unused');
  },
  descendants(fn) {
    const paragraph: DocNode = {
      isTextblock: true,
      isText: false,
      textContent: 'hello world',
      nodeSize: 13,
      childCount: 1,
      child: () => textNode('hello world'),
      descendants: () => {},
    };
    const container: DocNode = {
      attrs: { id: 'blk-1' },
      isTextblock: false,
      isText: false,
      textContent: 'hello world',
      nodeSize: 15,
      childCount: 1,
      child: () => paragraph,
      descendants: (inner) => inner(paragraph, 1),
    };
    if (fn(container, 0) !== false) container.descendants(fn);
  },
};

let selectionListener: (() => void) | null = null;
const unsubscribe = vi.fn();

function fakeEditor(anchor = 3, head = 3): CursorEditor {
  return {
    prosemirrorState: { doc, selection: { anchor, head } },
    prosemirrorView: {} as CursorEditor['prosemirrorView'],
    getTextCursorPosition: () => ({ block: { id: 'blk-1' } }),
    onSelectionChange: (callback) => {
      selectionListener = callback;
      return unsubscribe;
    },
  };
}

const peer = (over: Partial<DocPresence> = {}): DocPresence => ({
  docId: DOC,
  blockId: 'blk-1',
  anchor: 'anc-a',
  head: 'anc-b',
  name: 'Ada',
  colour: '#3b82f6',
  ...over,
});

const client = {
  resolveIds: vi.fn().mockResolvedValue([2, 2]),
  anchorAt: vi.fn().mockResolvedValue('anc-mine'),
};

const publish = vi.fn();

function mount(peers: Map<string, DocPresence>, editor: CursorEditor | null) {
  return renderHook(() =>
    useBodyCursors({
      client: client as unknown as DocsClient,
      docId: DOC,
      editor,
      peers,
      publish,
      revision: 'rev-1',
    }),
  );
}

beforeEach(() => {
  dispatched.length = 0;
  selectionListener = null;
  vi.clearAllMocks();
  client.resolveIds.mockResolvedValue([2, 2]);
  client.anchorAt.mockResolvedValue('anc-mine');
});

describe('useBodyCursors - drawing peers', () => {
  it('resolves a block once for every peer on it', async () => {
    const peers = new Map([
      ['alice', peer()],
      ['bob', peer({ anchor: 'anc-c', head: 'anc-d' })],
    ]);
    client.resolveIds.mockResolvedValue([2, 2, 4, 4]);
    await act(async () => {
      mount(peers, fakeEditor());
    });
    expect(client.resolveIds).toHaveBeenCalledTimes(1);
    expect(client.resolveIds).toHaveBeenCalledWith({
      doc: DOC,
      block: 'blk-1',
      anchors: ['anc-a', 'anc-b', 'anc-c', 'anc-d'],
    });
  });

  it('draws a caret at the resolved position', async () => {
    await act(async () => {
      mount(new Map([['alice', peer()]]), fakeEditor());
    });
    expect(lastDrawn()).toEqual([
      {
        kind: 'caret',
        author: 'alice',
        name: 'Ada',
        colour: '#3b82f6',
        pos: 4,
      },
    ]);
  });

  it('draws a selection when the peer has one', async () => {
    client.resolveIds.mockResolvedValue([0, 5]);
    await act(async () => {
      mount(new Map([['alice', peer()]]), fakeEditor());
    });
    expect(lastDrawn()).toEqual([
      {
        kind: 'selection',
        author: 'alice',
        name: 'Ada',
        colour: '#3b82f6',
        from: 2,
        to: 7,
      },
      {
        kind: 'caret',
        author: 'alice',
        name: 'Ada',
        colour: '#3b82f6',
        pos: 7,
      },
    ]);
  });

  it('skips an anchor this replica cannot place rather than drawing at 0', async () => {
    client.resolveIds.mockResolvedValue([null, null]);
    await act(async () => {
      mount(new Map([['alice', peer()]]), fakeEditor());
    });
    expect(lastDrawn()).toEqual([]);
  });

  it('ignores a peer whose caret is on the title', async () => {
    await act(async () => {
      mount(new Map([['alice', peer({ blockId: null })]]), fakeEditor());
    });
    expect(client.resolveIds).not.toHaveBeenCalled();
    expect(lastDrawn()).toEqual([]);
  });

  it('ignores a withdrawn caret', async () => {
    await act(async () => {
      mount(new Map([['alice', peer({ anchor: '', head: '' })]]), fakeEditor());
    });
    expect(client.resolveIds).not.toHaveBeenCalled();
  });

  it('draws nothing when a block cannot be resolved on this replica', async () => {
    client.resolveIds.mockRejectedValue(new Error('unknown block'));
    await act(async () => {
      mount(new Map([['alice', peer()]]), fakeEditor());
    });
    expect(lastDrawn()).toEqual([]);
  });
});

describe('useBodyCursors - publishing our own caret', () => {
  it('anchors both ends of the selection in scalar positions', async () => {
    await act(async () => {
      mount(new Map(), fakeEditor(2, 8));
    });
    expect(client.anchorAt).toHaveBeenCalledWith({
      doc: DOC,
      block: 'blk-1',
      position: 0,
      before: true,
    });
    expect(client.anchorAt).toHaveBeenLastCalledWith({
      doc: DOC,
      block: 'blk-1',
      position: 6,
      before: true,
    });
    expect(publish).toHaveBeenCalledWith({
      blockId: 'blk-1',
      anchor: 'anc-mine',
      head: 'anc-mine',
    });
  });

  it('republishes when the selection moves', async () => {
    await act(async () => {
      mount(new Map(), fakeEditor());
    });
    publish.mockClear();
    await act(async () => {
      selectionListener?.();
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('withdraws the caret when the editor goes away', async () => {
    let view: ReturnType<typeof mount> | null = null;
    await act(async () => {
      view = mount(new Map(), fakeEditor());
    });
    publish.mockClear();
    act(() => view!.unmount());
    expect(unsubscribe).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith({
      blockId: null,
      anchor: '',
      head: '',
    });
  });

  it('publishes nothing before the editor exists', async () => {
    await act(async () => {
      mount(new Map(), null);
    });
    expect(client.anchorAt).not.toHaveBeenCalled();
  });
});
