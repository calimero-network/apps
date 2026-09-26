// Folder rows must be operable from the keyboard: the name is a real
// button, and the chevron reports its expand/collapse state to assistive tech.
// A failed rename must tell the user, not just restore the old name silently.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  ['f1', { id: 'f1', alias: 'Product', color: null, visibility: 'Open' as const }],
]);

function renderRow(props: Partial<React.ComponentProps<typeof FolderTreeItem>> = {}) {
  return render(
    <FolderTreeItem
      node={node}
      byId={byId as never}
      selectedId={null}
      onSelect={vi.fn()}
      expanded={new Set()}
      onToggleExpanded={vi.fn()}
      selectedDocId={null}
      onOpenDoc={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('folder row keyboard access', () => {
  it('selects the folder when Enter is pressed on its name button', async () => {
    const onSelect = vi.fn();
    const onToggleExpanded = vi.fn();
    renderRow({ onSelect, onToggleExpanded });

    const nameButton = screen.getByRole('button', { name: 'Product' });
    nameButton.focus();
    await userEvent.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('f1');
    expect(onToggleExpanded).toHaveBeenCalledWith('f1');
  });

  it.each([
    { expanded: new Set<string>(), label: 'Expand Product', ariaExpanded: 'false' },
    { expanded: new Set(['f1']), label: 'Collapse Product', ariaExpanded: 'true' },
  ])(
    'reports $ariaExpanded state and names the folder in the chevron label',
    ({ expanded, label, ariaExpanded }) => {
      renderRow({ expanded });
      expect(
        screen.getByRole('button', { name: label }).getAttribute('aria-expanded'),
      ).toBe(ariaExpanded);
    },
  );
});

describe('FolderTreeItem rename failure', () => {
  it('toasts when the rename call rejects', async () => {
    rename.mockRejectedValueOnce(new Error('boom'));
    renderRow();

    fireEvent.click(screen.getByText('start-rename'));
    const input = screen.getByDisplayValue('Product');
    fireEvent.change(input, { target: { value: 'Finance' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByText('Product');
    expect(toastError).toHaveBeenCalledWith("Couldn't rename folder");
  });

  it('does not toast on a successful rename', async () => {
    rename.mockResolvedValueOnce(undefined);
    renderRow();

    fireEvent.click(screen.getByText('start-rename'));
    const input = screen.getByDisplayValue('Product');
    fireEvent.change(input, { target: { value: 'Finance' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByText('Product');
    expect(toastError).not.toHaveBeenCalled();
  });
});
