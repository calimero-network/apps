import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FolderContextMenu } from '../FolderContextMenu';

const remove = vi.fn();
const toastError = vi.hoisted(() => vi.fn());
const setSelectedFolder = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ selectedFolderId: null as string | null }));

vi.mock('sonner', () => ({
  toast: { error: toastError },
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'ns-1',
    rootGroupId: 'root',
    registryClient: {},
    applicationId: 'app-1',
    refetch: vi.fn(),
    folders: [{ id: 'f1', alias: 'Budget' }],
    allFolderNodes: [
      { id: 'f1', parent_id: null },
      { id: 'child', parent_id: 'f1' },
      { id: 'other', parent_id: null },
    ],
    selectedFolderId: route.selectedFolderId,
    setSelectedFolder,
  }),
}));
vi.mock('@/hooks/useFolderOperations', () => ({
  useFolderOperations: () => ({ create: vi.fn(), rename: vi.fn(), remove }),
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({
    canEditDocs: false,
    canRename: false,
    canCreateSubfolder: false,
    canDelete: true,
  }),
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));
vi.mock('../NewFolderDialog', () => ({ NewFolderDialog: () => null }));
vi.mock('../FolderInfoPanel', () => ({ FolderInfoPanel: () => null }));

function openMenuAndDelete() {
  const trigger = screen.getByLabelText('Folder actions');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));
}

function renderMenu() {
  render(
    <FolderContextMenu
      folderId="f1"
      currentVisibility="Open"
      onRename={vi.fn()}
      onNewSubfolder={vi.fn()}
      onNewDocument={vi.fn()}
    />,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  route.selectedFolderId = null;
});

describe('FolderContextMenu delete leaves the deleted folder', () => {
  it.each(['f1', 'child'])(
    'replaces a URL inside the deleted folder (%s) with workspace Home',
    async (open) => {
      route.selectedFolderId = open;
      remove.mockResolvedValueOnce(undefined);
      renderMenu();
      openMenuAndDelete();
      await waitFor(() =>
        expect(setSelectedFolder).toHaveBeenCalledWith(null, { replace: true }),
      );
    },
  );

  it('stays put when the open folder is elsewhere', async () => {
    route.selectedFolderId = 'other';
    remove.mockResolvedValueOnce(undefined);
    renderMenu();
    openMenuAndDelete();
    await waitFor(() => expect(remove).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(setSelectedFolder).not.toHaveBeenCalled();
  });

  it('stays put when the delete fails', async () => {
    route.selectedFolderId = 'f1';
    remove.mockRejectedValueOnce(new Error('delete boom'));
    renderMenu();
    openMenuAndDelete();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(setSelectedFolder).not.toHaveBeenCalled();
  });
});

describe('FolderContextMenu delete failure', () => {
  it('toasts instead of rendering the fixed error box', async () => {
    remove.mockRejectedValueOnce(new Error('delete boom'));
    render(
      <FolderContextMenu
        folderId="f1"
        currentVisibility="Open"
        onRename={vi.fn()}
        onNewSubfolder={vi.fn()}
        onNewDocument={vi.fn()}
      />,
    );
    openMenuAndDelete();

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't delete folder"),
    );
  });
});
