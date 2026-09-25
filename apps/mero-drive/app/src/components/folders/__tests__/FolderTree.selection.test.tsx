import React from 'react';
import { createPortal } from 'react-dom';
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
// Dialogs and menus portal out of the row but still bubble through React to it.
vi.mock('../FolderContextMenu', () => ({
  FolderContextMenu: ({ folderId }: { folderId: string }) =>
    createPortal(<button>Info for {folderId}</button>, document.body),
}));
vi.mock('../FolderDocLeaves', () => ({
  FolderDocLeaves: (p: { folderId: string; selectedDocId: string | null }) => (
    <li data-testid={`leaves-${p.folderId}`}>{String(p.selectedDocId)}</li>
  ),
}));
vi.mock('../NewFolderButton', () => ({ NewFolderButton: () => null }));

function renderTree(
  selectedDocId: string | null = null,
  onSelectFolder = vi.fn(),
) {
  render(
    <FolderTree
      selectedDocId={selectedDocId}
      onSelectFolder={onSelectFolder}
      onOpenDoc={vi.fn()}
    />,
  );
}

function folderRow() {
  return screen.getByText('Budget').parentElement as HTMLElement;
}

describe('selected folder highlight', () => {
  it('highlights the selected folder when no document is open', () => {
    renderTree();
    expect(folderRow().className).toContain('bg-selected');
  });

  // Only one row carries the selection: the open doc, not its folder too.
  it('drops the folder highlight while one of its documents is open', () => {
    renderTree('d1');
    expect(folderRow().className).not.toContain('bg-selected');
  });
});

describe('selecting a folder', () => {
  // The layout closes settings here, so a click on the folder already
  // selected must still be reported rather than skipped as a no-op.
  it('reports every row click, including the selected folder', () => {
    const onSelectFolder = vi.fn();
    renderTree(null, onSelectFolder);
    fireEvent.click(screen.getByText('Budget'));
    expect(onSelectFolder).toHaveBeenCalledWith('f1');
  });

  it('ignores clicks inside a dialog or menu opened from the row', () => {
    const onSelectFolder = vi.fn();
    render(
      <FolderTree
        selectedDocId={null}
        onSelectFolder={onSelectFolder}
        onOpenDoc={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Info for f2'));
    expect(onSelectFolder).not.toHaveBeenCalled();
  });
});

describe('open document highlight', () => {
  // Every folder has its own doc-1, so the open doc must only reach its own folder.
  it('passes the open doc id only to the folder that owns it', () => {
    renderTree('doc-1');
    for (const expand of screen.getAllByRole('button', { name: 'Expand' })) {
      fireEvent.click(expand);
    }
    expect(screen.getByTestId('leaves-f1').textContent).toBe('doc-1');
    expect(screen.getByTestId('leaves-f2').textContent).toBe('null');
  });
});
