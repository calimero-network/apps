import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FolderDocLeaves } from '../FolderDocLeaves';

const useDocsMock = vi.fn();
vi.mock('@/hooks/useDocs', () => ({ useDocs: (id: string) => useDocsMock(id) }));

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
      list: [{ id: 'd1', title: 'Brief' }, { id: 'd2', title: '' }],
    });
    const onOpenDoc = vi.fn();
    render(
      <ul>
        <FolderDocLeaves
          folderId="f1"
          selectedDocId={null}
          onOpenDoc={onOpenDoc}
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
        <FolderDocLeaves folderId="f1" selectedDocId={null} onOpenDoc={vi.fn()} />
      </ul>,
    );
    expect(screen.getByText(/Syncing/)).toBeTruthy();
  });

  it('renders nothing when the folder has no docs', () => {
    useDocsMock.mockReturnValue({ ...baseDocs, list: [] });
    render(
      <ul>
        <FolderDocLeaves folderId="f1" selectedDocId={null} onOpenDoc={vi.fn()} />
      </ul>,
    );
    // no list items rendered
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(useDocsMock).toHaveBeenCalledWith('f1');
  });
});
