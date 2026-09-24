// useMemberDisplayName can read null while the member rows carry the name, so
// the panel falls back to namespaceMemberNames, keyed by selfIdentity.

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MyDisplayNamePanel } from '../MyDisplayNamePanel';

const driveState = {
  namespaceId: 'ns',
  selfIdentity: 'me',
  namespaceMemberNames: {} as Record<string, string>,
};
const memberName = {
  name: null as string | null,
  loading: false,
  loaded: true,
};
const setName = vi.fn();

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => driveState,
}));
vi.mock('@/hooks/useMemberDisplayName', () => ({
  MAX_DISPLAY_NAME_LEN: 64,
  useMemberDisplayName: () => ({
    name: memberName.name,
    loading: memberName.loading,
    loaded: memberName.loaded,
    error: null,
    setName,
  }),
}));

describe('MyDisplayNamePanel', () => {
  beforeEach(() => {
    memberName.loading = false;
    memberName.loaded = true;
  });

  it('falls back to namespaceMemberNames when the metadata hook returns null', () => {
    memberName.name = null; // the hook reads null although the name is set
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

  it('keeps what the user typed when the stored name loads afterwards', () => {
    memberName.name = null;
    driveState.namespaceMemberNames = {};
    const { rerender } = render(<MyDisplayNamePanel />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Alice Astra' },
    });
    memberName.name = 'alice';
    rerender(<MyDisplayNamePanel />);
    expect(screen.getByDisplayValue('Alice Astra')).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled,
    ).toBe(false);
  });

  it('keeps the input editable while a background refetch runs', () => {
    memberName.name = 'alice';
    memberName.loading = true;
    render(<MyDisplayNamePanel />);
    expect(screen.getByRole<HTMLInputElement>('textbox').disabled).toBe(false);
  });

  it('disables the input until the first read has answered', () => {
    memberName.name = null;
    memberName.loaded = false;
    render(<MyDisplayNamePanel />);
    expect(screen.getByRole<HTMLInputElement>('textbox').disabled).toBe(true);
  });

  it('shows the saved name after a successful save', async () => {
    memberName.name = 'alice';
    driveState.namespaceMemberNames = {};
    setName.mockImplementationOnce(async (next: string) => {
      memberName.name = next;
    });
    render(<MyDisplayNamePanel />);
    const input = screen.getByRole<HTMLInputElement>('textbox');
    fireEvent.change(input, { target: { value: '  Bob  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(input.value).toBe('Bob'));
  });
});
