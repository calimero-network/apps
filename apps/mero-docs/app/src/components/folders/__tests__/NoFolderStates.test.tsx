import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NoFoldersState, SelectFolderState } from '../NoFolderStates';

const nsPerms = vi.fn();
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ namespaceId: 'ns-1', rootGroupId: 'ns-1' }),
}));
vi.mock('@/hooks/useNamespacePermissions', () => ({
  useNamespacePermissions: () => nsPerms(),
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({ canCreateSubfolder: false }),
}));
vi.mock('../NewFolderDialog', () => ({
  NewFolderDialog: () => <div role="dialog">New folder dialog</div>,
}));

describe.each([
  ['sidebar with no folders', NoFoldersState, 'No folders yet'],
  ['no folder selected', SelectFolderState, 'Select a folder'],
])('%s', (_label, State, heading) => {
  beforeEach(() => nsPerms.mockReset());

  it('offers New folder, which opens the New folder dialog', () => {
    nsPerms.mockReturnValue({ canCreateFolder: true });
    render(<State />);
    expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('has no New folder action for members who cannot create folders', () => {
    nsPerms.mockReturnValue({ canCreateFolder: false });
    render(<State />);
    expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
    expect(screen.queryByText(/create/i)).toBeNull();
  });
});
