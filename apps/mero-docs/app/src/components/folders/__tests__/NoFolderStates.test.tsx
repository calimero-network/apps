import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NoFoldersState } from '../NoFolderStates';

const workspace = { namespaceId: 'ns-1', rootGroupId: 'ns-1' };
const nsPerms = vi.fn();
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => workspace,
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

const allow = (canCreateFolder: boolean) =>
  nsPerms.mockReturnValue({ canCreateFolder, loading: false });

beforeEach(() => {
  nsPerms.mockReset();
});

describe('NoFoldersState', () => {
  it('offers a secondary New folder button that opens the dialog', () => {
    allow(true);
    render(<NoFoldersState />);
    expect(screen.getByText('No folders yet.')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'New folder' });
    expect(button.className).not.toContain('bg-primary');
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('has no New folder action for members who cannot create folders', () => {
    allow(false);
    render(<NoFoldersState />);
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
  });
});
