import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FolderEmptyState } from '../FolderEmptyState';

const useDocsMock = vi.fn();
vi.mock('@/hooks/useDocs', () => ({ useDocs: () => useDocsMock() }));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ namespaceId: 'ns1' }),
}));
const permsMock = vi.fn();
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => permsMock(),
}));

describe('FolderEmptyState', () => {
  beforeEach(() => {
    useDocsMock.mockReset();
    permsMock.mockReset();
  });

  it('creates and opens a doc when allowed', async () => {
    const create = vi.fn().mockResolvedValue('newdoc');
    useDocsMock.mockReturnValue({ create, contextId: 'ctx1' });
    permsMock.mockReturnValue({ canEditDocs: true });
    const onOpenDoc = vi.fn();
    render(<FolderEmptyState folderId="f1" onOpenDoc={onOpenDoc} />);
    fireEvent.click(screen.getByRole('button', { name: /New document/i }));
    await waitFor(() => expect(onOpenDoc).toHaveBeenCalledWith('f1', 'newdoc'));
  });

  it('hides the create button for read-only members', () => {
    useDocsMock.mockReturnValue({ create: vi.fn(), contextId: 'ctx1' });
    permsMock.mockReturnValue({ canEditDocs: false });
    render(<FolderEmptyState folderId="f1" onOpenDoc={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /New document/i })).toBeNull();
  });

  it('shows an error alert when create fails', async () => {
    const create = vi.fn().mockRejectedValue(new Error('network'));
    useDocsMock.mockReturnValue({ create, contextId: 'ctx1' });
    permsMock.mockReturnValue({ canEditDocs: true });
    render(<FolderEmptyState folderId="f1" onOpenDoc={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /New document/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
