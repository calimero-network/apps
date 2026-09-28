// The folder the URL points at is revealed in the tree: its ancestors open, and
// for an open document the folder itself too, so the doc's row shows.

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FolderTree } from '../FolderTree';

type Folder = { id: string; parent_id: string | null; alias: string };

const workspace = {
  folders: [] as Folder[],
  loading: false,
  stage: 'ready',
  error: null,
  selectedFolderId: null as string | null,
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
  useFolderOperations: () => ({ create: vi.fn(), rename: vi.fn(), remove: vi.fn() }),
}));
vi.mock('../FolderContextMenu', () => ({ FolderContextMenu: () => null }));
vi.mock('../FolderDocLeaves', () => ({ FolderDocLeaves: () => null }));
vi.mock('../NewFolderButton', () => ({ NewFolderButton: () => null }));

const NESTED: Folder[] = [
  { id: 'f1', parent_id: null, alias: 'Product' },
  { id: 'f2', parent_id: 'f1', alias: 'Specs' },
  { id: 'f3', parent_id: 'f2', alias: 'Drafts' },
  { id: 'f4', parent_id: null, alias: 'Other' },
];

function tree(selectedDocId: string | null) {
  return (
    <FolderTree selectedDocId={selectedDocId} onSelectFolder={vi.fn()} onOpenDoc={vi.fn()} />
  );
}

function isExpanded(alias: string): boolean {
  return !!screen.queryByRole('button', { name: `Collapse ${alias}` });
}

beforeEach(() => {
  workspace.folders = NESTED;
  workspace.selectedFolderId = null;
});

describe('the routed folder is revealed', () => {
  it('opens every ancestor of an open doc and its folder', () => {
    workspace.selectedFolderId = 'f3';
    render(tree('d1'));
    expect(isExpanded('Product')).toBe(true);
    expect(isExpanded('Specs')).toBe(true);
    expect(isExpanded('Drafts')).toBe(true);
    expect(isExpanded('Other')).toBe(false);
  });

  it('opens the ancestors of a selected folder but leaves the folder shut', () => {
    workspace.selectedFolderId = 'f3';
    render(tree(null));
    expect(isExpanded('Product')).toBe(true);
    expect(isExpanded('Specs')).toBe(true);
    expect(isExpanded('Drafts')).toBe(false);
  });

  // A reload mounts the tree before its folders have been read.
  it('reveals the folder once the folder list arrives', () => {
    workspace.folders = [];
    workspace.selectedFolderId = 'f2';
    const { rerender } = render(tree('d1'));
    workspace.folders = NESTED;
    rerender(tree('d1'));
    expect(isExpanded('Product')).toBe(true);
    expect(isExpanded('Specs')).toBe(true);
  });

  it('reveals a doc opened later from elsewhere', () => {
    const { rerender } = render(tree(null));
    expect(isExpanded('Product')).toBe(false);
    workspace.selectedFolderId = 'f2';
    rerender(tree('d1'));
    expect(isExpanded('Product')).toBe(true);
    expect(isExpanded('Specs')).toBe(true);
  });

  it('keeps a folder the user closed shut across a refresh', () => {
    workspace.selectedFolderId = 'f2';
    const { rerender } = render(tree('d1'));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Product' }));
    workspace.folders = [...NESTED];
    rerender(tree('d1'));
    expect(isExpanded('Product')).toBe(false);
  });
});
