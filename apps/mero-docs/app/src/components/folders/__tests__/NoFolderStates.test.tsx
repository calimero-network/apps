import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NoFoldersState, SelectFolderState } from '../NoFolderStates';

const workspace = { namespaceId: 'ns-1', rootGroupId: 'ns-1', folders: [{ id: 'f1' }] };
const nsPerms = vi.fn();
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => workspace,
}));
vi.mock('@/hooks/useNamespacePermissions', () => ({
  useNamespacePermissions: () => nsPerms(),
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({ canCreateSubfolder: false }),
}));
vi.mock('../NewFolderDialog', () => ({
  NewFolderDialog: () => <div role="dialog">New folder dialog</div>,
}));

const allow = (canCreateFolder: boolean) =>
  nsPerms.mockReturnValue({ canCreateFolder, loading: false });

beforeEach(() => {
  nsPerms.mockReset();
  workspace.folders = [{ id: 'f1' }];
});

describe('SelectFolderState with folders', () => {
  it('points at the sidebar and offers New folder', () => {
    allow(true);
    render(<SelectFolderState />);
    expect(screen.getByRole('heading', { name: 'Select a folder' })).toBeTruthy();
    expect(screen.getByText(/Pick one from the sidebar, or create a new one/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('has no New folder action for members who cannot create folders', () => {
    allow(false);
    render(<SelectFolderState />);
    expect(screen.getByText(/Pick one from the sidebar to see/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
  });
});

describe('SelectFolderState in a workspace with no folders', () => {
  beforeEach(() => {
    workspace.folders = [];
  });

  it('asks for the first folder instead of pointing at the empty sidebar', () => {
    allow(true);
    render(<SelectFolderState />);
    expect(screen.getByRole('heading', { name: 'No folders yet' })).toBeTruthy();
    expect(screen.getByText(/Create the first one/)).toBeTruthy();
    expect(screen.queryByText(/Pick one/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('tells read-only members an owner has to create or share a folder', () => {
    allow(false);
    render(<SelectFolderState />);
    expect(screen.getByText(/owner needs to create one or share one with you/)).toBeTruthy();
    expect(screen.queryByText(/Pick one/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
  });

  it('holds the body copy until permissions are known', () => {
    nsPerms.mockReturnValue({ canCreateFolder: false, loading: true });
    render(<SelectFolderState />);
    expect(screen.getByRole('heading', { name: 'No folders yet' })).toBeTruthy();
    expect(screen.queryByText(/Documents live in folders/)).toBeNull();
  });
});

describe('NoFoldersState', () => {
  it('offers a secondary New folder button that opens the dialog', () => {
    allow(true);
    render(<NoFoldersState />);
    expect(screen.getByText('No folders yet.')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'New folder' });
    expect(button.className).not.toContain('bg-primary');
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('has no New folder action for members who cannot create folders', () => {
    allow(false);
    render(<NoFoldersState />);
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
  });
});
