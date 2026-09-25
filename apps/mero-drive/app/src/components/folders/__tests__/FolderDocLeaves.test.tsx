import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FolderDocLeaves } from '../FolderDocLeaves';

const useDocsMock = vi.fn();
vi.mock('@/hooks/useDocs', () => ({
  useDocs: (id: string) => useDocsMock(id),
}));

const baseDocs = {
  list: [],
  create: vi.fn(),
  contextId: 'ctx1',
  contextResolving: false,
  loading: false,
  error: null as Error | null,
};

describe('FolderDocLeaves', () => {
  beforeEach(() => useDocsMock.mockReset());

  it('lists docs and calls onOpenDoc with folderId + docId on click', () => {
    useDocsMock.mockReturnValue({
      ...baseDocs,
      list: [
        { id: 'd1', title: 'Brief' },
        { id: 'd2', title: '' },
      ],
    });
    const onOpenDoc = vi.fn();
    render(
      <ul>
        <FolderDocLeaves
          folderId="f1"
          selectedDocId={null}
          onOpenDoc={onOpenDoc}
          createRequest={0}
        />
      </ul>,
    );
    expect(screen.getByText('Brief')).toBeTruthy();
    // empty title falls back to 'Untitled'
    expect(screen.getByText('Untitled')).toBeTruthy();
    fireEvent.click(screen.getByText('Brief'));
    expect(onOpenDoc).toHaveBeenCalledWith('f1', 'd1');
  });

  it('shows a syncing hint while the context resolves', () => {
    useDocsMock.mockReturnValue({
      ...baseDocs,
      contextId: null,
      contextResolving: true,
    });
    render(
      <ul>
        <FolderDocLeaves
          folderId="f1"
          selectedDocId={null}
          onOpenDoc={vi.fn()}
          createRequest={0}
        />
      </ul>,
    );
    expect(screen.getByText(/Syncing/)).toBeTruthy();
  });

  it('renders nothing when the folder has no docs', () => {
    useDocsMock.mockReturnValue({ ...baseDocs, list: [] });
    render(
      <ul>
        <FolderDocLeaves
          folderId="f1"
          selectedDocId={null}
          onOpenDoc={vi.fn()}
          createRequest={0}
        />
      </ul>,
    );
    // no list items rendered
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(useDocsMock).toHaveBeenCalledWith('f1');
  });

  describe('New document requests', () => {
    function leaves(createRequest: number, onOpenDoc = vi.fn()) {
      return (
        <ul>
          <FolderDocLeaves
            folderId="f1"
            selectedDocId={null}
            onOpenDoc={onOpenDoc}
            createRequest={createRequest}
          />
        </ul>
      );
    }

    it('does not create on mount', () => {
      const create = vi.fn();
      useDocsMock.mockReturnValue({ ...baseDocs, create });
      render(leaves(0));
      expect(create).not.toHaveBeenCalled();
    });

    it('creates one Untitled doc per request and opens it', async () => {
      const create = vi.fn().mockResolvedValue('doc-7');
      useDocsMock.mockReturnValue({ ...baseDocs, create });
      const onOpenDoc = vi.fn();
      const { rerender } = render(leaves(0, onOpenDoc));
      rerender(leaves(1, onOpenDoc));
      await waitFor(() =>
        expect(onOpenDoc).toHaveBeenCalledWith('f1', 'doc-7'),
      );
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith({ title: 'Untitled' });
    });

    it('waits for the folder context before creating', async () => {
      const create = vi.fn().mockResolvedValue('doc-1');
      useDocsMock.mockReturnValue({
        ...baseDocs,
        create,
        contextId: null,
        contextResolving: true,
      });
      const onOpenDoc = vi.fn();
      const { rerender } = render(leaves(0, onOpenDoc));
      rerender(leaves(1, onOpenDoc));
      expect(create).not.toHaveBeenCalled();
      useDocsMock.mockReturnValue({ ...baseDocs, create });
      rerender(leaves(1, onOpenDoc));
      await waitFor(() =>
        expect(onOpenDoc).toHaveBeenCalledWith('f1', 'doc-1'),
      );
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('reports a failed create', async () => {
      const create = vi.fn().mockRejectedValue(new Error('offline'));
      useDocsMock.mockReturnValue({ ...baseDocs, create });
      const { rerender } = render(leaves(0));
      rerender(leaves(1));
      expect((await screen.findByRole('alert')).textContent).toContain(
        'offline',
      );
    });
  });
});
