import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { FolderTree } from '../FolderTree';

// A Restricted folder the caller was added to, under a parent it cannot see,
// comes back from the core walk with no parent and `shared` set.
const workspace = {
  folders: [
    { id: 'f1', parent_id: null, alias: 'Budget', color: null, visibility: 'Open' },
    { id: 's1', parent_id: null, alias: 'Board pack', color: null, visibility: 'Restricted', shared: true },
  ],
  loading: false,
  stage: 'ready',
  error: null,
  selectedFolderId: null,
  setSelectedFolder: vi.fn(),
  namespaceId: 'ns-1',
  rootGroupId: 'ns-1',
  applicationId: 'app-1',
  refetch: vi.fn(),
};

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => workspace,
}));
vi.mock('@/hooks/useFolderOperations', () => ({
  useFolderOperations: () => ({ create: vi.fn(), rename: vi.fn(), remove: vi.fn() }),
}));
vi.mock('../FolderContextMenu', () => ({ FolderContextMenu: () => null }));
vi.mock('../FolderDocLeaves', () => ({ FolderDocLeaves: () => null }));
vi.mock('../NewFolderButton', () => ({ NewFolderButton: () => null }));

describe('Shared with me', () => {
  it('lists a folder reached only through its own membership apart from the workspace tree', () => {
    render(<FolderTree selectedDocId={null} onSelectFolder={vi.fn()} onOpenDoc={vi.fn()} />);
    const shared = screen.getByRole('region', { name: 'Shared with me' });
    expect(within(shared).getByText('Board pack')).toBeTruthy();
    expect(within(shared).queryByText('Budget')).toBeNull();
    expect(screen.getByText('Budget')).toBeTruthy();
  });
});
