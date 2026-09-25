// Folder rows must be operable from the keyboard: the name is a real
// button, and the chevron reports its expand/collapse state to assistive tech.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FolderTreeItem } from '../FolderTreeItem';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    rootGroupId: 'root',
    registryClient: {},
    applicationId: 'app-1',
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/useFolderOperations', () => ({
  useFolderOperations: () => ({ create: vi.fn(), rename: vi.fn(), remove: vi.fn() }),
}));

vi.mock('../FolderContextMenu', () => ({ FolderContextMenu: () => null }));
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

  it('reports collapsed state and names the folder in the chevron label', () => {
    renderRow();
    expect(
      screen
        .getByRole('button', { name: 'Expand Product' })
        .getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('reports expanded state and names the folder in the chevron label', () => {
    renderRow({ expanded: new Set(['f1']) });
    expect(
      screen
        .getByRole('button', { name: 'Collapse Product' })
        .getAttribute('aria-expanded'),
    ).toBe('true');
  });
});
