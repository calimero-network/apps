// Targeted tests for the admin-rename affordance on NamespaceMemberRow.
// We mock useAdminRenameMember / useMemberDisplayName / useDriveWorkspace
// at the module level so the test doesn't need a live MeroProvider tree.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NamespaceMemberRow } from '../NamespaceMemberRow';

const renameToMock = vi.fn();
const useAdminRenameMemberMock = vi.fn();

vi.mock('@/hooks/useAdminRenameMember', () => ({
  useAdminRenameMember: (...args: unknown[]) => useAdminRenameMemberMock(...args),
  MAX_DISPLAY_NAME_LEN: 64,
}));
vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: () => ({
    name: 'Bob',
    loading: false,
    error: null,
    setName: vi.fn(),
    refetch: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ namespaceId: 'ns', rootGroupId: 'ns' }),
}));
vi.mock('@calimero-network/mero-react', () => ({
  useGroupCapabilities: () => ({
    capabilities: 1,
    loading: false,
    error: null,
    refetch: vi.fn(),
    setCapabilities: vi.fn(),
  }),
}));
vi.mock('@/components/ui/confirm-dialog', async () => {
  const actual = await vi.importActual<
    typeof import('@/components/ui/confirm-dialog')
  >('@/components/ui/confirm-dialog');
  return { ...actual, useConfirm: () => async () => true };
});

describe('NamespaceMemberRow admin-rename affordance', () => {
  beforeEach(() => {
    renameToMock.mockReset();
    useAdminRenameMemberMock.mockReset();
  });

  it('hides the pencil when canRename is false', () => {
    useAdminRenameMemberMock.mockReturnValue({
      canRename: false,
      renameTo: renameToMock,
    });
    render(
      <NamespaceMemberRow
        groupId="ns"
        identity="bob-id"
        label="bob-id"
        role="Member"
        isSelf={false}
        canManage={true}
        onRemove={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.queryByLabelText(/^Rename /)).toBeNull();
  });

  it('hides the pencil for self rows even when canRename is true', () => {
    useAdminRenameMemberMock.mockReturnValue({
      canRename: true,
      renameTo: renameToMock,
    });
    render(
      <NamespaceMemberRow
        groupId="ns"
        identity="self-id"
        label="self-id"
        role="Member"
        isSelf={true}
        canManage={true}
        onRemove={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.queryByLabelText(/^Rename /)).toBeNull();
  });

  it('shows the pencil when canRename is true and row is not self', () => {
    useAdminRenameMemberMock.mockReturnValue({
      canRename: true,
      renameTo: renameToMock,
    });
    render(
      <NamespaceMemberRow
        groupId="ns"
        identity="bob-id"
        label="bob-id"
        role="Member"
        isSelf={false}
        canManage={true}
        onRemove={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByLabelText(/^Rename /)).toBeTruthy();
  });

  it('clicking the pencil enters edit mode and saving fires renameTo', async () => {
    useAdminRenameMemberMock.mockReturnValue({
      canRename: true,
      renameTo: renameToMock,
    });
    renameToMock.mockResolvedValue(undefined);
    render(
      <NamespaceMemberRow
        groupId="ns"
        identity="bob-id"
        label="bob-id"
        role="Member"
        isSelf={false}
        canManage={true}
        onRemove={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByLabelText(/^Rename /));
    const input = screen.getByLabelText(/^Rename /) as HTMLInputElement;
    expect(input.value).toBe('Bob');
    fireEvent.change(input, { target: { value: 'Alice' } });
    fireEvent.click(screen.getByLabelText('Save'));
    // submitRename awaits renameTo + refetchName then exits edit mode.
    // We don't need to await the promise chain here — the mock fired
    // synchronously when click handler invoked it; flush microtasks
    // to let promise resolution settle for any post-assertions.
    await Promise.resolve();
    expect(renameToMock).toHaveBeenCalledWith('Alice');
  });

  it('Escape cancels the edit without firing renameTo', () => {
    useAdminRenameMemberMock.mockReturnValue({
      canRename: true,
      renameTo: renameToMock,
    });
    render(
      <NamespaceMemberRow
        groupId="ns"
        identity="bob-id"
        label="bob-id"
        role="Member"
        isSelf={false}
        canManage={true}
        onRemove={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByLabelText(/^Rename /));
    const input = screen.getByLabelText(/^Rename /);
    fireEvent.change(input, { target: { value: 'Alice' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(renameToMock).not.toHaveBeenCalled();
    // After cancel, the pencil button is back (label points to the
    // button again, not the input).
    expect(screen.getByLabelText(/^Rename /).tagName).toBe('BUTTON');
  });
});
