import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
    {
      id: 'f2',
      parent_id: null,
      alias: 'Designs',
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
vi.mock('../FolderDocLeaves', () => ({
  FolderDocLeaves: (p: { folderId: string; selectedDocId: string | null }) => (
    <li data-testid={`leaves-${p.folderId}`}>{String(p.selectedDocId)}</li>
  ),
}));
vi.mock('../NewFolderButton', () => ({ NewFolderButton: () => null }));

function folderRow() {
  return screen.getByText('Budget').parentElement as HTMLElement;
}

describe('selected folder highlight', () => {
  it('highlights the selected folder when no document is open', () => {
    render(
      <FolderTree
        selectedDocId={null}
        onSelectFolder={vi.fn()}
        onOpenDoc={vi.fn()}
      />,
    );
    expect(folderRow().className).toContain('bg-selected');
  });

  // Only one row carries the selection: the open doc, not its folder too.
  it('drops the folder highlight while one of its documents is open', () => {
    render(
      <FolderTree
        selectedDocId="d1"
        onSelectFolder={vi.fn()}
        onOpenDoc={vi.fn()}
      />,
    );
    expect(folderRow().className).not.toContain('bg-selected');
  });
});

describe('selecting a folder', () => {
  // The layout closes settings here, so a click on the folder already
  // selected must still be reported rather than skipped as a no-op.
  it('reports every row click, including the selected folder', () => {
    const onSelectFolder = vi.fn();
    render(
      <FolderTree
        selectedDocId={null}
        onSelectFolder={onSelectFolder}
        onOpenDoc={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Budget'));
    expect(onSelectFolder).toHaveBeenCalledWith('f1');
  });
});
