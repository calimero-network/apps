// `useEphemeral` is faked so a test can read every slice the hook publishes.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDocPresence } from '../useDocPresence';

const CTX = 'docs-ctx';
const DOC = 'doc-1';
const CARET = { blockId: null, anchor: 'a', head: 'b' };
const NO_CARET = { blockId: null, anchor: '', head: '' };

const setPresence = vi.fn();
vi.mock('@calimero-network/mero-react', () => ({
  useEphemeral: () => ({ peers: new Map(), setPresence }),
}));

function render(name: string, doc = DOC) {
  return renderHook(
    ({ who, id }) => useDocPresence(CTX, id, { id: 'bob-account', name: who }),
    { initialProps: { who: name, id: doc } },
  );
}

beforeEach(() => setPresence.mockClear());

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

  it('stays silent until the identity resolves', () => {
    renderHook(() => useDocPresence(CTX, DOC, null));
    expect(setPresence).not.toHaveBeenCalled();
  });
});
