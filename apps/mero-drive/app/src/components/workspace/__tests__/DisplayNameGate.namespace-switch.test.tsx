import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MeroContext } from '@calimero-network/mero-react';
import { DisplayNameGate } from '../DisplayNameGate';

// Runs the real useMemberDisplayName + mero-react useMemberMetadata, so the
// ordering below goes through the same fetch path the app uses.
const driveState = {
  namespaceId: 'old-ns',
  selfIdentity: 'me',
  namespaceMemberNames: {} as Record<string, string>,
};
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => driveState,
}));
// Whichever context the hook listens on, the last handler is the old workspace's.
let onContextEvent = () => {};
vi.mock('@/hooks/useContextEvents', () => ({
  useContextEvents: (_contextId: unknown, onChange: () => void) => {
    onContextEvent = onChange;
  },
}));

describe('DisplayNameGate across a namespace switch', () => {
  it('shows the gate for a new unnamed workspace when a refetch for the previous one lands late', async () => {
    let resolveLateRefetch: (v: { name: string }) => void = () => {};
    let oldNsCalls = 0;
    const getMemberMetadata = vi.fn((ns: string) => {
      if (ns === 'new-ns') return Promise.resolve(null);
      oldNsCalls += 1;
      if (oldNsCalls === 1) return Promise.resolve({ name: 'alice' });
      return new Promise((resolve) => {
        resolveLateRefetch = resolve;
      });
    });
    const mero = { admin: { getMemberMetadata } };
    const ui = () => (
      <MeroContext.Provider value={{ mero } as any}>
        <DisplayNameGate />
      </MeroContext.Provider>
    );

    const { rerender } = render(ui());
    await waitFor(() =>
      expect(localStorage.getItem('mero-name-set:old-ns:me')).toBe('1'),
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    // An event on the old workspace starts a refetch, then the user
    // creates a new workspace before that refetch answers.
    act(() => onContextEvent());
    driveState.namespaceId = 'new-ns';
    rerender(ui());
    const gate = await screen.findByRole('dialog', { name: /Set your name/i });
    await act(async () => resolveLateRefetch({ name: 'alice' }));

    expect(gate.isConnected).toBe(true);
    expect(localStorage.getItem('mero-name-set:new-ns:me')).toBeNull();
  });
});
