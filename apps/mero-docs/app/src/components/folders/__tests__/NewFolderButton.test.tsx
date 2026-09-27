import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NewFolderButton } from '../NewFolderButton';

let canCreateFolder = true;
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ namespaceId: 'ns-1', rootGroupId: 'ns-1' }),
}));
vi.mock('@/hooks/useNamespacePermissions', () => ({
  useNamespacePermissions: () => ({ canCreateFolder }),
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({ canCreateSubfolder: false }),
}));
vi.mock('../NewFolderDialog', () => ({
  NewFolderDialog: () => (
    <div role="dialog">
      <input aria-label="Folder name" />
    </div>
  ),
}));

beforeEach(() => {
  canCreateFolder = true;
});

describe('NewFolderButton', () => {
  it('keeps an open dialog when a permission re-read briefly says no', () => {
    const { rerender } = render(<NewFolderButton parentFolderId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const input = screen.getByRole('textbox', { name: 'Folder name' });

    canCreateFolder = false;
    rerender(<NewFolderButton parentFolderId={null} />);
    expect(screen.getByRole('textbox', { name: 'Folder name' })).toBe(input);
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
  });
});
