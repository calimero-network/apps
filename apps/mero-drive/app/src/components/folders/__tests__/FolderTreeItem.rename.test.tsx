// A failed rename must tell the user, not just restore the old name silently.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FolderTreeItem } from '../FolderTreeItem';

const rename = vi.fn();
const toastError = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({
  toast: { error: toastError },
}));

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    rootGroupId: 'root',
    registryClient: {},
    applicationId: 'app-1',
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/useFolderOperations', () => ({
  useFolderOperations: () => ({ create: vi.fn(), rename, remove: vi.fn() }),
}));

// Exposes the "start rename" affordance without dragging in the real
// dropdown menu, confirm dialogs, and permission hooks.
vi.mock('../FolderContextMenu', () => ({
  FolderContextMenu: ({ onRename }: { onRename: () => void }) => (
    <button onClick={onRename}>start-rename</button>
  ),
}));
vi.mock('../FolderDocLeaves', () => ({ FolderDocLeaves: () => null }));

const node = { id: 'f1', children: [] };
const byId = new Map([
  ['f1', { id: 'f1', alias: 'Budget', color: null, visibility: 'Open' as const }],
]);

function renderRow() {
  render(
    <FolderTreeItem
      node={node}
      byId={byId as never}
      selectedId={null}
      onSelect={vi.fn()}
      expanded={new Set()}
      onToggleExpanded={vi.fn()}
      selectedDocId={null}
      onOpenDoc={vi.fn()}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('FolderTreeItem rename failure', () => {
  it('toasts when the rename call rejects', async () => {
    rename.mockRejectedValueOnce(new Error('boom'));
    renderRow();

    fireEvent.click(screen.getByText('start-rename'));
    const input = screen.getByDisplayValue('Budget');
    fireEvent.change(input, { target: { value: 'Finance' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByText('Budget');
    expect(toastError).toHaveBeenCalledWith("Couldn't rename folder");
  });

  it('does not toast on a successful rename', async () => {
    rename.mockResolvedValueOnce(undefined);
    renderRow();

    fireEvent.click(screen.getByText('start-rename'));
    const input = screen.getByDisplayValue('Budget');
    fireEvent.change(input, { target: { value: 'Finance' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByText('Budget');
    expect(toastError).not.toHaveBeenCalled();
  });
});
