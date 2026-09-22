// The title binding, driven with a fake client that answers fixed tokens and
// positions, so every assertion is the exact call the backend would receive.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { useFugueTitle, type TitleClient } from '../useFugueTitle';

const setPresence = vi.fn();
let peers = new Map<string, unknown>();
let deliver: ((event: unknown) => void) | null = null;

vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: (_ids: string[], handler: (event: unknown) => void) => {
    deliver = handler;
  },
  useEphemeral: () => ({
    peers,
    setPresence,
    ageOf: () => undefined,
    error: null,
  }),
}));


const DOC = 'doc-1';
const CTX = 'ctx-1';

type FakeClient = { [K in keyof TitleClient]: Mock };

function fakeClient(): FakeClient {
  return {
    getTitle: vi.fn().mockResolvedValue('Notes'),
    titleApplyDelta: vi.fn().mockResolvedValue('tok-1'),
    titleUndo: vi.fn().mockResolvedValue('redo-1'),
    titleAnchorAt: vi.fn().mockResolvedValue('anc-1'),
    titleResolve: vi.fn().mockResolvedValue([3]),
  };
}

const titleEvent = (doc: string) => ({
  contextId: CTX,
  type: 'StateMutation',
  data: { events: [{ kind: 'TitleChanged', data: payload({ doc, ids: [] }) }] },
});

const payload = (value: unknown) =>
  Array.from(new TextEncoder().encode(JSON.stringify(value)));

const change = (value: string) =>
  ({ target: { value } }) as ChangeEvent<HTMLInputElement>;

const settle = async (ms = 400) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function mount(client: FakeClient, identity?: { id: string; name: string }) {
  return renderHook(() =>
    useFugueTitle({
      client: client as unknown as TitleClient,
      docId: DOC,
      contextId: CTX,
      identity,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  setPresence.mockClear();
  peers = new Map();
  deliver = null;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('useFugueTitle', () => {
  it('reads the title of the document it is pointed at', async () => {
    const client = fakeClient();
    const { result } = mount(client);
    await settle();
    expect(client.getTitle).toHaveBeenCalledWith({ doc: DOC });
    expect(result.current.title).toBe('Notes');
  });

  it('sends a typed character as one scalar-indexed delta', async () => {
    const client = fakeClient();
    const { result } = mount(client);
    await settle();
    act(() => result.current.onChange(change('Notes!')));
    expect(client.titleApplyDelta).toHaveBeenCalledWith({
      doc: DOC,
      ops: [{ retain: 5 }, { insert: '!' }],
    });
    expect(result.current.title).toBe('Notes!');
  });

  it('sends no delta when the value did not change', async () => {
    const client = fakeClient();
    const { result } = mount(client);
    await settle();
    act(() => result.current.onChange(change('Notes')));
    expect(client.titleApplyDelta).not.toHaveBeenCalled();
  });

  it('undoes with the token the write returned, and redoes with its answer', async () => {
    const client = fakeClient();
    const { result } = mount(client);
    await settle();
    act(() => result.current.onChange(change('Notes!')));
    await settle();

    act(() => result.current.undo());
    await settle();
    expect(client.titleUndo).toHaveBeenCalledWith({ doc: DOC, token: 'tok-1' });

    act(() => result.current.redo());
    await settle();
    expect(client.titleUndo).toHaveBeenLastCalledWith({
      doc: DOC,
      token: 'redo-1',
    });
  });

  it('mints an anchor at the caret in scalar positions', async () => {
    const client = fakeClient();
    client.getTitle.mockResolvedValue('a\u{1F44B}b');
    const { result } = mount(client);
    await settle();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.value = 'a\u{1F44B}b';
    input.setSelectionRange(3, 3);
    result.current.inputRef.current = input;

    act(() => result.current.onSelect());
    await settle();
    expect(client.titleAnchorAt).toHaveBeenCalledWith({
      doc: DOC,
      position: 2,
      before: true,
    });
  });

  it('publishes the caret anchor as presence for this document', async () => {
    const client = fakeClient();
    const { result } = mount(client, { id: 'alice', name: 'Ada' });
    await settle();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.value = 'Notes';
    input.setSelectionRange(2, 2);
    result.current.inputRef.current = input;

    act(() => result.current.onSelect());
    await settle();
    expect(setPresence).toHaveBeenCalledWith({
      docId: DOC,
      blockId: null,
      anchor: 'anc-1',
      head: 'anc-1',
      name: 'Ada',
      colour: '#3b82f6',
    });
  });

  it('publishes nothing when there is no identity to publish as', async () => {
    const client = fakeClient();
    const { result } = mount(client);
    await settle();
    const input = document.createElement('input');
    document.body.appendChild(input);
    result.current.inputRef.current = input;
    act(() => result.current.onSelect());
    await settle();
    expect(setPresence).not.toHaveBeenCalled();
  });

  it('re-reads on a peer TitleChanged and restores the caret through the anchor', async () => {
    const client = fakeClient();
    const { result } = mount(client);
    await settle();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.value = 'Notes';
    input.setSelectionRange(3, 3);
    input.focus();
    const setSelection = vi.spyOn(input, 'setSelectionRange');
    result.current.inputRef.current = input;
    act(() => result.current.onSelect());
    await settle();

    client.getTitle.mockResolvedValue('Meeting notes');
    client.titleResolve.mockResolvedValue([8]);
    act(() => deliver?.(titleEvent(DOC)));
    await settle();

    expect(client.titleResolve).toHaveBeenCalledWith({
      doc: DOC,
      anchors: ['anc-1'],
    });
    expect(result.current.title).toBe('Meeting notes');
    expect(setSelection).toHaveBeenCalledWith(8, 8);
  });

  it('ignores a TitleChanged for another document', async () => {
    const client = fakeClient();
    mount(client);
    await settle();
    client.getTitle.mockClear();
    act(() => deliver?.(titleEvent('doc-2')));
    await settle();
    expect(client.getTitle).not.toHaveBeenCalled();
  });

  it('leaves the title alone when the re-read matches its own write', async () => {
    const client = fakeClient();
    const { result } = mount(client);
    await settle();
    act(() => result.current.onChange(change('Notes!')));
    await settle();
    client.getTitle.mockResolvedValue('Notes!');

    act(() => deliver?.(titleEvent(DOC)));
    await settle();
    expect(client.titleResolve).not.toHaveBeenCalled();
    expect(result.current.title).toBe('Notes!');
  });

  it('coalesces a burst of peer events into one re-read', async () => {
    const client = fakeClient();
    mount(client);
    await settle();
    client.getTitle.mockClear();
    act(() => {
      deliver?.(titleEvent(DOC));
      deliver?.(titleEvent(DOC));
      deliver?.(titleEvent(DOC));
    });
    await settle();
    expect(client.getTitle).toHaveBeenCalledTimes(1);
  });

  it('keeps only the peers editing this document', async () => {
    peers = new Map([
      ['alice', { docId: DOC, name: 'Ada' }],
      ['bob', { docId: 'doc-2', name: 'Bo' }],
    ]);
    const client = fakeClient();
    const { result } = mount(client);
    await settle();
    expect([...result.current.peers.keys()]).toEqual(['alice']);
  });

  it('surfaces a failed write as an error', async () => {
    const client = fakeClient();
    client.titleApplyDelta.mockRejectedValue(new Error('offline'));
    const { result } = mount(client);
    await settle();
    act(() => result.current.onChange(change('Notes!')));
    await settle();
    expect(result.current.error?.message).toBe('offline');
  });
});
