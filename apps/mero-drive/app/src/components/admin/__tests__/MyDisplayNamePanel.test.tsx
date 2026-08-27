// Regression for the "Your display name shows 'Not set yet' even though the
// name is set (and shown in the members list)" bug: useMemberDisplayName can
// return null on a fresh load (mero-react rehydration gap #42), so the panel
// falls back to namespaceMemberNames (the namespace GroupMember rows the
// members list reads), keyed by selfIdentity.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MyDisplayNamePanel } from '../MyDisplayNamePanel';

const driveState = {
  namespaceId: 'ns',
  selfIdentity: 'me',
  namespaceMemberNames: {} as Record<string, string>,
};
const memberName = { name: null as string | null };

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => driveState,
}));
vi.mock('@/hooks/useMemberDisplayName', () => ({
  MAX_DISPLAY_NAME_LEN: 64,
  useMemberDisplayName: () => ({
    name: memberName.name,
    loading: false,
    error: null,
    setName: vi.fn(),
  }),
}));

describe('MyDisplayNamePanel', () => {
  it('falls back to namespaceMemberNames when the metadata hook returns null', () => {
    memberName.name = null; // #42: hook null even though name is set
    driveState.namespaceMemberNames = { me: 'ronit' };
    render(<MyDisplayNamePanel />);
    // The input is pre-filled with the fallback name (not blank / "Not set yet").
    expect(screen.getByDisplayValue('ronit')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Not set yet')).toBeNull();
  });

  it('shows "Not set yet" only when neither source has a name', () => {
    memberName.name = null;
    driveState.namespaceMemberNames = {};
    render(<MyDisplayNamePanel />);
    expect(screen.getByPlaceholderText('Not set yet')).toBeTruthy();
  });

  it('prefers the metadata hook value when present', () => {
    memberName.name = 'hook-name';
    driveState.namespaceMemberNames = { me: 'stale-list-name' };
    render(<MyDisplayNamePanel />);
    expect(screen.getByDisplayValue('hook-name')).toBeTruthy();
  });
});
