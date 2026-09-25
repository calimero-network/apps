import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FolderTree } from '../FolderTree';

const workspace = {
  folders: [
    {
      id: 'f1',
      parent_id: null,
      alias: 'Budget',
      color: null,
      visibility: 'Open',
    },
  ],
  loading: false,
  stage: 'ready',
  error: null,
  selectedFolderId: 'f1',
  setSelectedFolder: vi.fn(),
  namespaceId: 'ns-1',
  rootGroupId: 'ns-1',
  registryClient: null,
  applicationId: 'app-1',
  refetch: vi.fn(),
};

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => workspace,
}));
vi.mock('@/hooks/useFolderOperations', () => ({
  useFolderOperations: () => ({
    create: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  }),
}));
vi.mock('../FolderContextMenu', () => ({ FolderContextMenu: () => null }));
vi.mock('../FolderDocLeaves', () => ({ FolderDocLeaves: () => null }));
vi.mock('../NewFolderButton', () => ({ NewFolderButton: () => null }));

function folderRow() {
  return screen.getByText('Budget').parentElement as HTMLElement;
}

describe('selected folder highlight', () => {
  it('highlights the selected folder when no document is open', () => {
    render(<FolderTree selectedDocId={null} onOpenDoc={vi.fn()} />);
    expect(folderRow().className).toContain('bg-selected');
  });

  // Only one row carries the selection: the open doc, not its folder too.
  it('drops the folder highlight while one of its documents is open', () => {
    render(<FolderTree selectedDocId="d1" onOpenDoc={vi.fn()} />);
    expect(folderRow().className).not.toContain('bg-selected');
  });
});
