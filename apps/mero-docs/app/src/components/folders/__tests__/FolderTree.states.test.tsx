import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FolderTree } from '../FolderTree';

const refetch = vi.fn().mockResolvedValue(undefined);
let mockState: {
  folders: unknown[];
  loading: boolean;
  stage: string;
  error: Error | null;
  selectedFolderId: string | null;
  namespaceId: string | null;
  rootGroupId: string | null;
};

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ ...mockState, refetch }),
}));
vi.mock('@/hooks/useNamespacePermissions', () => ({
  useNamespacePermissions: () => ({ canCreateFolder: true }),
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({ canCreateSubfolder: false }),
}));
// Holds typed text in its own state, so a remount would show as a new, empty node.
vi.mock('../NewFolderDialog', () => ({
  NewFolderDialog: () => (
    <div role="dialog">
      <input aria-label="Folder name" />
    </div>
  ),
}));

beforeEach(() => {
  refetch.mockClear();
  mockState = {
    folders: [],
    loading: false,
    stage: 'ready',
    error: null,
    selectedFolderId: null,
    namespaceId: 'ns-1',
    rootGroupId: 'ns-1',
  };
});

describe('FolderTree loading state', () => {
  it('shows the stage label with a spinner, and never the empty state', () => {
    mockState.loading = true;
    mockState.stage = 'loading-folders';
    render(
      <FolderTree
        selectedDocId={null}
        onSelectFolder={vi.fn()}
        onOpenDoc={vi.fn()}
      />,
    );
    expect(screen.getByText('Loading folders…')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('No folders yet.')).toBeNull();
  });
});

describe('FolderTree error state', () => {
  it('shows the plain error message with a Try again button that re-runs the load', () => {
    mockState.error = new Error('boom');
    render(
      <FolderTree
        selectedDocId={null}
        onSelectFolder={vi.fn()}
        onOpenDoc={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Couldn't load your folders. Try refreshing the page."),
    ).toBeTruthy();
    expect(screen.queryByText('No folders yet.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('FolderTree section header', () => {
  it('collapses and expands the folder list from the Folders header', () => {
    render(
      <FolderTree
        selectedDocId={null}
        onSelectFolder={vi.fn()}
        onOpenDoc={vi.fn()}
      />,
    );
    const header = screen.getByRole('button', { name: 'Folders' });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('No folders yet.')).toBeNull();
    fireEvent.click(header);
    expect(screen.getByText('No folders yet.')).toBeTruthy();
  });

  it('follows a caller that controls the collapsed state', () => {
    const onToggleCollapsed = vi.fn();
    render(
      <FolderTree
        selectedDocId={null}
        onSelectFolder={vi.fn()}
        onOpenDoc={vi.fn()}
        collapsed
        onToggleCollapsed={onToggleCollapsed}
      />,
    );
    expect(screen.queryByText('No folders yet.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Folders' }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('No folders yet.')).toBeNull();
  });
});

describe('FolderTree keeps an open dialog through a later reload', () => {
  const tree = () => (
    <FolderTree
      selectedDocId={null}
      onSelectFolder={vi.fn()}
      onOpenDoc={vi.fn()}
    />
  );

  it.each([
    [
      'a loading pulse',
      () => {
        mockState.loading = true;
        mockState.stage = 'loading-folders';
      },
    ],
    [
      'a failed re-read',
      () => {
        mockState.error = new Error('boom');
      },
    ],
  ])('survives %s with the same node and focus', async (_, pulse) => {
    const user = userEvent.setup();
    const { rerender } = render(tree());
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const input = screen.getByRole('textbox', { name: 'Folder name' });
    input.focus();
    fireEvent.change(input, { target: { value: 'Notes' } });

    pulse();
    rerender(tree());
    expect(screen.getByRole('textbox', { name: 'Folder name' })).toBe(input);
    await user.keyboard('!'); // lands in the field only if it kept focus
    expect((input as HTMLInputElement).value).toBe('Notes!');
  });

  it('still shows the loader on a first load for another workspace', () => {
    const { rerender } = render(tree());
    mockState.namespaceId = 'ns-2';
    mockState.rootGroupId = 'ns-2';
    mockState.loading = true;
    mockState.stage = 'loading-folders';
    rerender(tree());
    expect(screen.getByText('Loading folders…')).toBeTruthy();
  });
});
