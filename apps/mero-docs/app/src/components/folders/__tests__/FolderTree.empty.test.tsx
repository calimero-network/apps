import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FolderTree } from '../FolderTree';

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    folders: [],
    loading: false,
    stage: 'ready',
    error: null,
    selectedFolderId: null,
    namespaceId: 'ns-1',
    rootGroupId: 'ns-1',
  }),
}));
vi.mock('@/hooks/useNamespacePermissions', () => ({
  useNamespacePermissions: () => ({ canCreateFolder: true }),
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({ canCreateSubfolder: false }),
}));
vi.mock('../NewFolderDialog', () => ({
  NewFolderDialog: () => <div role="dialog">New folder dialog</div>,
}));

describe('FolderTree with no folders', () => {
  it('offers a New folder button that opens the New folder dialog', () => {
    render(<FolderTree selectedDocId={null} onSelectFolder={vi.fn()} onOpenDoc={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'No folders yet' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
