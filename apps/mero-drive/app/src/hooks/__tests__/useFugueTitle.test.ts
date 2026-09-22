// The title binding, driven with a fake client that answers fixed tokens and
// positions, so every assertion is the exact call the backend would receive.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import type { DocsClient } from '@/generated/docs/DocsClient';
import { useFugueTitle } from '../useFugueTitle';

const publish = vi.fn();
let deliver: ((event: unknown) => void) | null = null;

vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: (_ids: string[], handler: (event: unknown) => void) => {
    deliver = handler;
  },
}));

const DOC = 'doc-1';
const CTX = 'ctx-1';

type FakeClient = Record<'getTitle' | 'titleApplyDeltaOn' | 'titleUndo' | 'titleAnchorAt', Mock>;

const applied = (text: string, token = 'tok-1') => ({ applied: true, token, text });
const refused = (text: string) => ({ applied: false, token: null, text });

function fakeClient(): FakeClient {
  return {
    getTitle: vi.fn().mockResolvedValue('Notes'),
    titleApplyDeltaOn: vi.fn(),
    titleUndo: vi.fn().mockResolvedValue('redo-1'),
    titleAnchorAt: vi.fn().mockResolvedValue('anc-1'),
  };
}

/** A focused input holding `value` with the caret at `caret`, bound to the hook. */
function focusedInput(result: { current: { inputRef: { current: HTMLInputElement | null } } }, value: string, caret: number) {
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.value = value;
  input.focus();
  input.setSelectionRange(caret, caret);
  result.current.inputRef.current = input;
  return input;
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

function mount(client: FakeClient, withPresence = false) {
  return renderHook(() =>
    useFugueTitle({
      client: client as unknown as DocsClient,
      docId: DOC,
      contextId: CTX,
      publish: withPresence ? publish : undefined,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  publish.mockClear();
  deliver = null;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('useFugueTitle', () => {
  it('reads the title of the document it is pointed at', async () => {
    const { result } = mount(fakeClient());
    await settle();
    expect(result.current.title).toBe('Notes');
  });

  it('reports loaded only once the title has been read', async () => {
    const client = fakeClient();
    let resolveRead: (value: string) => void = () => {};
    client.getTitle.mockReturnValueOnce(new Promise<string>((resolve) => (resolveRead = resolve)));
    const { result } = mount(client);
    await settle();
    expect(result.current.loaded).toBe(false);
    await act(async () => resolveRead('Notes'));
    await settle();
    expect(result.current.loaded).toBe(true);
    expect(result.current.title).toBe('Notes');
  });

  it('sends a typed character as one delta guarded by the title it was diffed against', async () => {
    const client = fakeClient();
    client.titleApplyDeltaOn.mockResolvedValue(applied('Notes!'));
    const { result } = mount(client);
    await settle();
    act(() => result.current.onChange(change('Notes!')));
    await settle();
    expect(client.titleApplyDeltaOn).toHaveBeenCalledTimes(1);
    expect(client.titleApplyDeltaOn).toHaveBeenCalledWith({
      doc: DOC,
      base: 'Notes',
      ops: [{ retain: 5 }, { insert: '!' }],
    });
    expect(result.current.status).toBe('saved');
  });

  it('sends no delta when the value did not change', async () => {
    const client = fakeClient();
    const { result } = mount(client);
    await settle();
    act(() => result.current.onChange(change('Notes')));
    await settle();
    expect(client.titleApplyDeltaOn).not.toHaveBeenCalled();
  });

  it('rebases a refused write onto the peer title and resends it', async () => {
    const client = fakeClient();
    client.titleApplyDeltaOn
      .mockResolvedValueOnce(refused('My Notes'))
      .mockResolvedValueOnce(applied('My Notes!'));
    const { result } = mount(client);
    await settle();
    act(() => result.current.onChange(change('Notes!')));
    await settle();
    expect(result.current.title).toBe('My Notes!');
    expect(client.titleApplyDeltaOn).toHaveBeenLastCalledWith({
      doc: DOC,
      base: 'My Notes',
      ops: [{ retain: 8 }, { insert: '!' }],
    });
  });

  it('carries the caret through a peer change instead of resetting it', async () => {
    const client = fakeClient();
    const { result } = mount(client);
    await settle();
    const input = focusedInput(result, 'Notes', 5);
    const setSelection = vi.spyOn(input, 'setSelectionRange');

    client.getTitle.mockResolvedValue('Meeting Notes');
    act(() => deliver?.(titleEvent(DOC)));
    await settle();

    expect(result.current.title).toBe('Meeting Notes');
    expect(setSelection).toHaveBeenLastCalledWith(13, 13);
  });

  it('keeps a keystroke typed while a peer change is being read', async () => {
    const client = fakeClient();
    client.titleApplyDeltaOn.mockResolvedValue(applied('Meeting Notes!'));
    const { result } = mount(client);
    await settle();
    focusedInput(result, 'Notes', 5);

    let resolveRead: (value: string) => void = () => {};
    client.getTitle.mockReturnValueOnce(new Promise<string>((resolve) => (resolveRead = resolve)));
    act(() => deliver?.(titleEvent(DOC)));
    await settle(100);
    act(() => result.current.onChange(change('Notes!')));
    await act(async () => resolveRead('Meeting Notes'));
    await settle();

    expect(result.current.title).toBe('Meeting Notes!');
    expect(client.titleApplyDeltaOn).toHaveBeenCalledWith({
      doc: DOC,
      base: 'Meeting Notes',
      ops: [{ retain: 13 }, { insert: '!' }],
    });
  });

  it('undoes with the token the write returned, and redoes with its answer', async () => {
    const client = fakeClient();
    client.titleApplyDeltaOn.mockResolvedValue(applied('Notes!', 'tok-7'));
    const { result } = mount(client);
    await settle();
    act(() => result.current.onChange(change('Notes!')));
    await settle();
    act(() => result.current.undo());
    await settle();
    expect(client.titleUndo).toHaveBeenCalledWith({ doc: DOC, token: 'tok-7' });
    act(() => result.current.redo());
    await settle();
    expect(client.titleUndo).toHaveBeenLastCalledWith({ doc: DOC, token: 'redo-1' });
  });

  /** Two writes `gap` ms apart, answered with tokens tok-a and tok-b. */
  async function twoWrites(gap: number) {
    const client = fakeClient();
    client.titleApplyDeltaOn
      .mockResolvedValueOnce(applied('Notes!', 'tok-a'))
      .mockResolvedValueOnce(applied('Notes!!', 'tok-b'));
    client.titleUndo.mockImplementation(({ token }: { token: string }) => Promise.resolve(`inv-${token}`));
    const { result } = mount(client);
    await settle();
    act(() => result.current.onChange(change('Notes!')));
    await settle(gap);
    act(() => result.current.onChange(change('Notes!!')));
    await settle();
    return { client, result };
  }

  const undoTokens = (client: FakeClient) => client.titleUndo.mock.calls.map(([arg]) => arg.token);

  it('undoes a typing burst as one step, newest write first, and redoes it oldest first', async () => {
    const { client, result } = await twoWrites(100);
    act(() => result.current.undo());
    await settle();
    expect(undoTokens(client)).toEqual(['tok-b', 'tok-a']);
    act(() => result.current.redo());
    await settle();
    expect(undoTokens(client)).toEqual(['tok-b', 'tok-a', 'inv-tok-a', 'inv-tok-b']);
  });

  it('starts a new undo step after a pause in typing', async () => {
    const { client, result } = await twoWrites(1000);
    act(() => result.current.undo());
    await settle();
    expect(undoTokens(client)).toEqual(['tok-b']);
  });

  it('takes the undo and redo shortcuts in the title through its own history', async () => {
    const { client, result } = await twoWrites(1000);
    const key = (init: KeyboardEventInit) => {
      const event = { ...init, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLInputElement>;
      act(() => result.current.onKeyDown(event));
      return event.preventDefault as Mock;
    };
    expect(key({ key: 'z', metaKey: true })).toHaveBeenCalled();
    await settle();
    expect(undoTokens(client)).toEqual(['tok-b']);
    expect(key({ key: 'Z', metaKey: true, shiftKey: true })).toHaveBeenCalled();
    await settle();
    expect(undoTokens(client)).toEqual(['tok-b', 'inv-tok-b']);
    expect(key({ key: 'z' })).not.toHaveBeenCalled();
    expect(undoTokens(client)).toHaveLength(2);
  });

  it('mints an anchor at the caret in scalar positions', async () => {
    const client = fakeClient();
    client.getTitle.mockResolvedValue('a\u{1F44B}b');
    const { result } = mount(client);
    await settle();
    focusedInput(result, 'a\u{1F44B}b', 3);
    act(() => result.current.onSelect());
    await settle();
    expect(client.titleAnchorAt).toHaveBeenCalledWith({ doc: DOC, position: 2, before: true });
  });

  it('publishes the caret anchor as presence for this document', async () => {
    const client = fakeClient();
    const { result } = mount(client, true);
    await settle();
    focusedInput(result, 'Notes', 2);
    act(() => result.current.onSelect());
    await settle();
    expect(publish).toHaveBeenCalledWith({ blockId: null, anchor: 'anc-1', head: 'anc-1' });
  });

  it('publishes nothing when the view gave it nowhere to publish', async () => {
    const client = fakeClient();
    const { result } = mount(client);
    await settle();
    focusedInput(result, 'Notes', 2);
    act(() => result.current.onSelect());
    await settle();
    expect(publish).not.toHaveBeenCalled();
  });

  it('ignores a TitleChanged for another document', async () => {
    const client = fakeClient();
    mount(client);
    await settle();
    const reads = client.getTitle.mock.calls.length;
    act(() => deliver?.(titleEvent('other-doc')));
    await settle();
    expect(client.getTitle).toHaveBeenCalledTimes(reads);
  });

  it('surfaces a failed write as an error', async () => {
    const client = fakeClient();
    client.titleApplyDeltaOn.mockRejectedValue(new Error('refused'));
    const { result } = mount(client);
    await settle();
    act(() => result.current.onChange(change('Notes!')));
    await settle();
    expect(result.current.error?.message).toBe('refused');
    expect(result.current.status).toBe('error');
  });
});
