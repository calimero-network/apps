// `useEphemeral` is faked so a test can read every slice the hook publishes,
// and `mero.ephemeral.set` so it can read the leave sent when a doc closes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDocPresence } from '../useDocPresence';
import { PRESENCE_LEAVE_REPEAT_MS } from '@/lib/presenceTiming';

const CTX = 'docs-ctx';
const DOC = 'doc-1';
const CARET = { blockId: null, anchor: 'a', head: 'b' };
const NO_CARET = { blockId: null, anchor: '', head: '' };

const setPresence = vi.fn();
const set = vi.fn(async () => {});
let peers = new Map<string, unknown>();
let ages = new Map<string, number>();
// Stable like mero-react's useCallback, so a render alone never re-reads ages.
const ageOf = (author: string) => ages.get(author);
// Stable like the provider's client, so a re-render never looks like a new context.
const MERO = { mero: { ephemeral: { set } } };
vi.mock('@calimero-network/mero-react', () => ({
  useEphemeral: () => ({ peers, setPresence, ageOf }),
  useMero: () => MERO,
}));

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

const slice = (docId: string) => ({
  docId,
  ...NO_CARET,
  name: 'Ann',
  colour: '#f00',
});

function render(name: string, doc = DOC) {
  return renderHook(
    ({ who, id }) => useDocPresence(CTX, id, { id: 'bob-account', name: who }),
    { initialProps: { who: name, id: doc } },
  );
}

beforeEach(() => {
  setPresence.mockClear();
  set.mockClear();
  peers = new Map();
  ages = new Map();
});

afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

describe('useDocPresence', () => {
  it('announces itself under the current name before any caret exists', () => {
    render('bob');
    expect(setPresence).toHaveBeenLastCalledWith(
      expect.objectContaining({ ...NO_CARET, docId: DOC, name: 'bob' }),
    );
  });

  it('announces a new name after a remount, with no caret move', () => {
    const { result, unmount } = render('bob');
    result.current.publish(CARET);
    unmount();
    setPresence.mockClear();
    render('Bob Beta');
    expect(setPresence).toHaveBeenLastCalledWith(
      expect.objectContaining({ docId: DOC, name: 'Bob Beta' }),
    );
  });

  it('republishes the last caret under a new name', () => {
    const { result, rerender } = render('bob');
    result.current.publish(CARET);
    rerender({ who: 'Bob Beta', id: DOC });
    expect(setPresence).toHaveBeenLastCalledWith(
      expect.objectContaining({ ...CARET, docId: DOC, name: 'Bob Beta' }),
    );
  });

  it('does not carry a caret over to another doc', () => {
    const { result, rerender } = render('bob');
    result.current.publish(CARET);
    rerender({ who: 'bob', id: 'doc-2' });
    expect(setPresence).toHaveBeenLastCalledWith(
      expect.objectContaining({ ...NO_CARET, docId: 'doc-2' }),
    );
  });

  it('leaves when the doc closes, since the node replays the last slice', () => {
    const { unmount } = render('bob');
    expect(set).not.toHaveBeenCalled();
    unmount();
    expect(set).toHaveBeenCalledWith(CTX, {});
  });

  it('leaves again a moment later, in case a caret update lands after the first leave', () => {
    vi.useFakeTimers();
    const { unmount } = render('bob');
    unmount();
    expect(set).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PRESENCE_LEAVE_REPEAT_MS);
    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenLastCalledWith(CTX, {});
    vi.useRealTimers();
  });

  it('ignores a caret write from the closed editor, so the repeated leave still goes out', () => {
    vi.useFakeTimers();
    const { result, unmount } = render('bob');
    const late = result.current.publish;
    unmount();
    setPresence.mockClear();
    late(CARET);
    expect(setPresence).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PRESENCE_LEAVE_REPEAT_MS);
    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenLastCalledWith(CTX, {});
    vi.useRealTimers();
  });

  it('ignores a caret write while the tab is hidden', () => {
    const { result } = render('bob');
    setHidden(true);
    setPresence.mockClear();
    result.current.publish(CARET);
    expect(setPresence).not.toHaveBeenCalled();
    setHidden(false);
    expect(setPresence).toHaveBeenLastCalledWith(
      expect.objectContaining({ docId: DOC }),
    );
  });

  it('never repeats a leave once the next doc has announced', () => {
    vi.useFakeTimers();
    const { rerender } = render('bob');
    rerender({ who: 'bob', id: 'doc-2' });
    vi.advanceTimersByTime(PRESENCE_LEAVE_REPEAT_MS);
    expect(set).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('leaves the old doc before announcing the next one', () => {
    const { rerender } = render('bob');
    rerender({ who: 'bob', id: 'doc-2' });
    expect(set).toHaveBeenCalledTimes(1);
    expect(setPresence).toHaveBeenLastCalledWith(
      expect.objectContaining({ docId: 'doc-2' }),
    );
  });

  it('stays silent until the identity resolves', () => {
    renderHook(() => useDocPresence(CTX, DOC, null));
    expect(setPresence).not.toHaveBeenCalled();
  });

  describe('staying fresh', () => {
    beforeEach(() => vi.useFakeTimers());

    it('refreshes its slice every beat while the doc is open, and stops on close', () => {
      const { result, unmount } = render('bob');
      result.current.publish(CARET);
      setPresence.mockClear();
      act(() => vi.advanceTimersByTime(10_000));
      expect(setPresence).toHaveBeenCalledTimes(1);
      expect(setPresence).toHaveBeenLastCalledWith(
        expect.objectContaining({ ...CARET, docId: DOC, n: 1 }),
      );
      act(() => vi.advanceTimersByTime(10_000));
      expect(setPresence).toHaveBeenLastCalledWith(
        expect.objectContaining({ n: 2 }),
      );
      unmount();
      setPresence.mockClear();
      act(() => vi.advanceTimersByTime(30_000));
      expect(setPresence).not.toHaveBeenCalled();
    });

    it('leaves when the tab is hidden, and comes back when it is shown', () => {
      render('bob');
      act(() => setHidden(true));
      expect(set).toHaveBeenCalledWith(CTX, {});
      setPresence.mockClear();
      act(() => vi.advanceTimersByTime(30_000));
      expect(setPresence).not.toHaveBeenCalled();
      act(() => setHidden(false));
      expect(setPresence).toHaveBeenLastCalledWith(
        expect.objectContaining({ docId: DOC, name: 'bob' }),
      );
    });

    it('drops a peer not heard from within the stale window, on the next beat', () => {
      peers = new Map([
        ['fresh', slice(DOC)],
        ['ghost', slice(DOC)],
      ]);
      ages = new Map([
        ['fresh', 1_000],
        ['ghost', 24_000],
      ]);
      const { result } = render('bob');
      expect([...result.current.peers.keys()]).toEqual(['fresh', 'ghost']);
      ages.set('ghost', 25_000);
      act(() => vi.advanceTimersByTime(10_000));
      expect([...result.current.peers.keys()]).toEqual(['fresh']);
    });
  });
});
