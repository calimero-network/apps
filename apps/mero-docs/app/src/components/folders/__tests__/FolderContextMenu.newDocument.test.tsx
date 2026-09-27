import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FolderContextMenu } from '../FolderContextMenu';

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
  useFolderOperations: () => ({ create: vi.fn(), rename: vi.fn(), remove: vi.fn() }),
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({
    canEditDocs: true,
    canRename: true,
    canCreateSubfolder: true,
    canDelete: true,
  }),
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));
vi.mock('../NewFolderDialog', () => ({ NewFolderDialog: () => null }));
vi.mock('../FolderInfoPanel', () => ({ FolderInfoPanel: () => null }));

describe('FolderContextMenu new-document double-create guard', () => {
  it('disables the inline New document button while a create is pending', () => {
    render(
      <FolderContextMenu
        folderId="f1"
        currentVisibility="Open"
        onRename={vi.fn()}
        onNewSubfolder={vi.fn()}
        onNewDocument={vi.fn()}
        newDocPending
      />,
    );
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'New document' })
        .disabled,
    ).toBe(true);
  });

  it('disables the New document dropdown item while a create is pending', async () => {
    render(
      <FolderContextMenu
        folderId="f1"
        currentVisibility="Open"
        onRename={vi.fn()}
        onNewSubfolder={vi.fn()}
        onNewDocument={vi.fn()}
        newDocPending
      />,
    );
    const trigger = screen.getByLabelText('Folder actions');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    const item = await screen.findByRole('menuitem', { name: 'New document' });
    expect(item.getAttribute('data-disabled')).not.toBeNull();
  });

  it('leaves the button enabled when nothing is pending', () => {
    render(
      <FolderContextMenu
        folderId="f1"
        currentVisibility="Open"
        onRename={vi.fn()}
        onNewSubfolder={vi.fn()}
        onNewDocument={vi.fn()}
      />,
    );
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'New document' })
        .disabled,
    ).toBe(false);
  });
});
