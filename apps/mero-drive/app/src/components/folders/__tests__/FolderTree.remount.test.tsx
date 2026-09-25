// "The folder list flickers because of the refresh and it's building components
// again" — as a test.
//
// The flicker was a TEARDOWN, not a repaint: `FolderTree` returns a one-line
// placeholder whenever the workspace reports `loading`, and the workspace
// reported `loading` on every background refetch. So the whole `<ul>` and every
// row inside it unmounted and remounted a few times a minute.
//
// The assertion is therefore about DOM NODE IDENTITY, not about text being
// present. A remount produces a new element for the same folder; React
// reconciling an update keeps the same element and mutates it. Only the first
// distinguishes the two, and only the first fails against the old behaviour.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
// vitest hoists `vi.mock` above every import, so this resolves against the
// mocks declared below.
import { FolderTree } from '../FolderTree';

const workspace = {
  folders: [] as Array<{
    id: string;
    parent_id: string | null;
    alias?: string;
    color?: string | null;
    visibility?: 'Open' | 'Restricted';
  }>,
  loading: false,
  stage: 'ready' as string,
  error: null as Error | null,
  selectedFolderId: null as string | null,
  setSelectedFolder: vi.fn(),
  namespaceId: 'ns-1' as string | null,
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

const folder = (id: string, alias: string) => ({
  id,
  parent_id: null,
  alias,
  color: null,
  visibility: 'Open' as const,
});

beforeEach(() => {
  workspace.folders = [folder('f1', 'Budget'), folder('f2', 'Designs')];
  workspace.loading = false;
  workspace.stage = 'ready';
  workspace.error = null;
});

function renderTree() {
  return render(<FolderTree selectedDocId={null} onSelectFolder={vi.fn()} onOpenDoc={vi.fn()} />);
}

describe('a background refresh does not rebuild the tree', () => {
  // ⚠️ THE REGRESSION. `loading` must stay false while a refetch is in flight
  // for a workspace whose folders have already loaded once — that is the
  // contract `deriveDriveStage` now enforces, and this is what depends on it.
  it('keeps the same DOM node for a folder across a refresh with equal data', () => {
    const { rerender } = renderTree();
    const before = screen.getByText('Budget');

    // A refresh that returns the same content. `loadRegFolders` deliberately
    // returns the PREVIOUS array in this case, so the reference is identical.
    rerender(<FolderTree selectedDocId={null} onSelectFolder={vi.fn()} onOpenDoc={vi.fn()} />);

    expect(screen.getByText('Budget')).toBe(before);
  });

  it('keeps the same DOM node even when the array identity is new', () => {
    const { rerender } = renderTree();
    const before = screen.getByText('Budget');

    // A fresh array with equal contents — what a refetch produces if the
    // content compare is ever removed. Row identity must survive it, because
    // the rows are keyed by folder id.
    workspace.folders = [folder('f1', 'Budget'), folder('f2', 'Designs')];
    rerender(<FolderTree selectedDocId={null} onSelectFolder={vi.fn()} onOpenDoc={vi.fn()} />);

    expect(screen.getByText('Budget')).toBe(before);
  });

  // The failure this whole change is about: had `loading` flipped true, the
  // `<ul>` would be replaced by the placeholder and this node would be gone.
  it('never replaces the list with a placeholder mid-refresh', () => {
    const { rerender } = renderTree();
    const before = screen.getByText('Budget');
    rerender(<FolderTree selectedDocId={null} onSelectFolder={vi.fn()} onOpenDoc={vi.fn()} />);
    expect(screen.queryByText('Loading folders…')).toBeNull();
    expect(screen.getByText('Budget')).toBe(before);
  });
});

describe('the fix does not freeze the tree', () => {
  it('renders a folder added by a refresh', () => {
    const { rerender } = renderTree();
    expect(screen.queryByText('Notes')).toBeNull();

    workspace.folders = [...workspace.folders, folder('f3', 'Notes')];
    rerender(<FolderTree selectedDocId={null} onSelectFolder={vi.fn()} onOpenDoc={vi.fn()} />);

    expect(screen.getByText('Notes')).toBeTruthy();
  });

  it('drops a folder removed by a refresh', () => {
    const { rerender } = renderTree();
    expect(screen.getByText('Designs')).toBeTruthy();

    workspace.folders = [folder('f1', 'Budget')];
    rerender(<FolderTree selectedDocId={null} onSelectFolder={vi.fn()} onOpenDoc={vi.fn()} />);

    expect(screen.queryByText('Designs')).toBeNull();
  });

  it('renames one folder without disturbing its siblings', () => {
    const { rerender } = renderTree();
    // The untouched sibling is the anchor: if the rename rebuilt the list
    // rather than updating one row, this node would be replaced too.
    const untouched = screen.getByText('Designs');

    workspace.folders = [folder('f1', 'Q3 Budget'), folder('f2', 'Designs')];
    rerender(<FolderTree selectedDocId={null} onSelectFolder={vi.fn()} onOpenDoc={vi.fn()} />);

    expect(screen.getByText('Q3 Budget')).toBeTruthy();
    expect(screen.queryByText('Budget')).toBeNull();
    expect(screen.getByText('Designs')).toBe(untouched);
  });
});

describe('the first load still shows a skeleton', () => {
  it('shows the stage label when the workspace reports loading', () => {
    workspace.loading = true;
    workspace.stage = 'loading-folders';
    renderTree();
    expect(screen.getByText('Loading folders…')).toBeTruthy();
    expect(screen.queryByText('Budget')).toBeNull();
  });
});
