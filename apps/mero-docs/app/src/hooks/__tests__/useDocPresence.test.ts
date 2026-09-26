// `useEphemeral` is faked so a test can read every slice the hook publishes.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDocPresence } from '../useDocPresence';

const CTX = 'docs-ctx';
const DOC = 'doc-1';
const CARET = { blockId: null, anchor: 'a', head: 'b' };

const setPresence = vi.fn();
vi.mock('@calimero-network/mero-react', () => ({
  useEphemeral: () => ({ peers: new Map(), setPresence }),
}));

function render(name: string) {
  return renderHook(
    ({ who }) => useDocPresence(CTX, DOC, { id: 'bob-account', name: who }),
    { initialProps: { who: name } },
  );
}

beforeEach(() => setPresence.mockClear());

describe('useDocPresence', () => {
  it('republishes the last caret under a new name', () => {
    const { result, rerender } = render('bob');
    result.current.publish(CARET);
    rerender({ who: 'Bob Beta' });
    expect(setPresence).toHaveBeenLastCalledWith(
      expect.objectContaining({ ...CARET, docId: DOC, name: 'Bob Beta' }),
    );
  });

  it('does not carry a caret over to another doc', () => {
    const { result, rerender } = renderHook(
      ({ doc }) => useDocPresence(CTX, doc, { id: 'bob-account', name: 'bob' }),
      { initialProps: { doc: DOC } },
    );
    result.current.publish(CARET);
    setPresence.mockClear();
    rerender({ doc: 'doc-2' });
    expect(setPresence).not.toHaveBeenCalled();
  });

  it('stays silent on a rename before any caret exists', () => {
    const { rerender } = render('bob');
    rerender({ who: 'Bob Beta' });
    expect(setPresence).not.toHaveBeenCalled();
  });
});
