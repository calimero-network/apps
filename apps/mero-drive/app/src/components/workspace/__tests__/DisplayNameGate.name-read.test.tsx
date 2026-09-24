import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  act,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { MeroContext } from '@calimero-network/mero-react';
import { DisplayNameGate } from '../DisplayNameGate';

// Real useMemberDisplayName + mero-react useMemberMetadata, so the gate sees
// the same loading sequence the app does: idle, then loading, then answered.
const driveState = {
  namespaceId: 'ns',
  selfIdentity: 'me',
  namespaceMemberNames: {} as Record<string, string>,
};
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => driveState,
}));
let onContextEvent = () => {};
vi.mock('@/hooks/useContextEvents', () => ({
  useContextEvents: (_contextId: unknown, onChange: () => void) => {
    onContextEvent = onChange;
  },
}));

function renderGate(getMemberMetadata: () => Promise<unknown>) {
  const mero = { admin: { getMemberMetadata } };
  return render(
    <MeroContext.Provider value={{ mero } as any}>
      <DisplayNameGate />
    </MeroContext.Provider>,
  );
}

// Records every dialog the gate ever attached, however briefly.
let observer: MutationObserver;
let dialogsAttached: number;
function countAttachedDialogs(records: MutationRecord[]) {
  for (const r of records) {
    for (const n of r.addedNodes) {
      if (n instanceof HTMLElement && n.querySelector('[role="dialog"]'))
        dialogsAttached += 1;
      if (n instanceof HTMLElement && n.getAttribute('role') === 'dialog')
        dialogsAttached += 1;
    }
  }
}

describe('DisplayNameGate decides only once the name read has answered', () => {
  beforeEach(() => {
    localStorage.clear();
    dialogsAttached = 0;
    observer = new MutationObserver(countAttachedDialogs);
    observer.observe(document.body, { childList: true, subtree: true });
  });
  afterEach(() => observer.disconnect());

  it('never shows the gate to a member whose name is already set', async () => {
    renderGate(() => Promise.resolve({ name: 'alice' }));
    // The gate persists this marker once it has seen the loaded name.
    await waitFor(() =>
      expect(localStorage.getItem('mero-name-set:ns:me')).toBe('1'),
    );
    countAttachedDialogs(observer.takeRecords());
    expect(dialogsAttached).toBe(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the gate and the typed name while a background refetch runs', async () => {
    let answerRefetch: (v: null) => void = () => {};
    let holdReads = false;
    renderGate(() =>
      holdReads
        ? new Promise((resolve) => {
            answerRefetch = resolve;
          })
        : Promise.resolve(null),
    );
    const gate = await screen.findByRole('dialog', { name: /Set your name/i });
    fireEvent.change(screen.getByPlaceholderText('Your display name'), {
      target: { value: 'bob' },
    });

    holdReads = true;
    act(() => onContextEvent());
    expect(gate.isConnected).toBe(true);
    expect(
      (screen.getByPlaceholderText('Your display name') as HTMLInputElement)
        .value,
    ).toBe('bob');

    await act(async () => answerRefetch(null));
    expect(gate.isConnected).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled'),
    ).toBe(false);
  });
});
