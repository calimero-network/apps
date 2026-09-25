import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FolderContextMenu } from '../FolderContextMenu';

const remove = vi.fn();
const toastError = vi.hoisted(() => vi.fn());

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
