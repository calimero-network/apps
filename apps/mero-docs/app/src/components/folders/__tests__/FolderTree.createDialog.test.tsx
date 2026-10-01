// A fresh window's first folder read can come back empty, so the sidebar shows
// "No folders yet." with its own New folder button - and swaps it for the
// header's once the folders land. A dialog opened from the first button must
// survive that swap. Found by the rich e2e: the dialog vanished mid-setup and
// `createFolder` timed out waiting for its name field.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FolderTree } from '../FolderTree';

const workspace = {
  folders: [] as Array<{
    id: string;
    parent_id: string | null;
    alias?: string;
    color?: string | null;
    visibility?: 'Open' | 'Restricted';
  }>,
  loading: false,
  stage: 'ready' as string,
  error: null as Error | null,
  selectedFolderId: null as string | null,
  setSelectedFolder: vi.fn(),
  namespaceId: 'ns-1' as string | null,
  rootGroupId: 'ns-1',
  registryClient: null,
  applicationId: 'app-1',
  refetch: vi.fn(),
};

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => workspace,
}));
vi.mock('@/hooks/useNamespacePermissions', () => ({
  useNamespacePermissions: () => ({ canCreateFolder: true, loading: false }),
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({ canCreateSubfolder: false }),
}));
vi.mock('@/hooks/useFolderOperations', () => ({
  useFolderOperations: () => ({ create: vi.fn(), rename: vi.fn(), remove: vi.fn() }),
}));
vi.mock('../FolderContextMenu', () => ({ FolderContextMenu: () => null }));
vi.mock('../FolderDocLeaves', () => ({ FolderDocLeaves: () => null }));
vi.mock('../NewFolderDialog', () => ({
  NewFolderDialog: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog">
      <input placeholder="Folder name" />
      <button onClick={onClose}>Cancel</button>
    </div>
  ),
}));

const tree = () => (
  <FolderTree selectedDocId={null} onSelectFolder={vi.fn()} onOpenDoc={vi.fn()} />
);

beforeEach(() => {
  workspace.folders = [];
});

describe('the New folder dialog', () => {
  it('stays open when the folders land after it was opened from the empty state', () => {
    const { rerender } = render(tree());
    expect(screen.getByText('No folders yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const field = screen.getByPlaceholderText('Folder name');

    workspace.folders = [
      { id: 'f1', parent_id: null, alias: 'Budget', color: null, visibility: 'Open' },
    ];
    rerender(tree());

    expect(screen.queryByText('No folders yet.')).toBeNull();
    expect(screen.getByText('Budget')).toBeTruthy();
    // The same field, not a fresh dialog: what the user typed is still there.
    expect(screen.getByPlaceholderText('Folder name')).toBe(field);
  });

  it('opens from the header button and closes', () => {
    workspace.folders = [
      { id: 'f1', parent_id: null, alias: 'Budget', color: null, visibility: 'Open' },
    ];
    render(tree());
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
