// A subfolder created under a collapsed parent must be visible without the
// user hunting for the chevron: choosing "New subfolder" reveals the parent.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FolderTree } from '../FolderTree';

const folder = (id: string, alias: string, parent_id: string | null) => ({
  id,
  parent_id,
  alias,
  color: null,
  visibility: 'Open' as const,
});

const workspace = {
  folders: [folder('f1', 'Parent', null), folder('f2', 'Child', 'f1')],
  loading: false,
  stage: 'ready',
  error: null,
  selectedFolderId: null,
  setSelectedFolder: vi.fn(),
  namespaceId: 'ns-1',
  rootGroupId: 'ns-1',
  registryClient: null,
  applicationId: 'app-1',
  refetch: vi.fn(),
};

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => workspace,
}));
vi.mock('@/hooks/useFolderOperations', () => ({
  useFolderOperations: () => ({ create: vi.fn(), rename: vi.fn(), remove: vi.fn() }),
}));
vi.mock('../FolderContextMenu', () => ({
  FolderContextMenu: ({
    folderId,
    onNewSubfolder,
  }: {
    folderId: string;
    onNewSubfolder: () => void;
  }) => (
    // The real menu content stops propagation, so the row never sees the click.
    <button
      onClick={(e) => {
        e.stopPropagation();
        onNewSubfolder();
      }}
    >
      New subfolder in {folderId}
    </button>
  ),
}));
vi.mock('../FolderDocLeaves', () => ({ FolderDocLeaves: () => null }));
vi.mock('../NewFolderButton', () => ({ NewFolderButton: () => null }));

describe('New subfolder', () => {
  it('expands the parent so the new folder shows up in the tree', () => {
    render(<FolderTree selectedDocId={null} onSelectFolder={vi.fn()} onOpenDoc={vi.fn()} />);
    expect(screen.queryByText('Child')).toBeNull();

    fireEvent.click(screen.getByText('New subfolder in f1'));

    expect(screen.getByText('Child')).toBeTruthy();
  });

  it('leaves an already expanded parent open', () => {
    render(<FolderTree selectedDocId={null} onSelectFolder={vi.fn()} onOpenDoc={vi.fn()} />);
    fireEvent.click(screen.getByText('New subfolder in f1'));
    fireEvent.click(screen.getByText('New subfolder in f1'));

    expect(screen.getByText('Child')).toBeTruthy();
  });
});
