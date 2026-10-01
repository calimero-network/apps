import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DocsClient, DocSearchPage } from '@/generated/docs/DocsClient';
import type { IndexRow } from '@/lib/workspaceIndex/types';
import { INDEX_CATCH_UP_MS, useDocSearch } from '../useDocSearch';

const row = (updatedAt: number): IndexRow => ({
  folderId: 'f1',
  docId: 'plan',
  title: 'Plan',
  tags: [],
  archived: false,
  createdAt: 0,
  updatedAt,
  createdBy: 'a',
  updatedBy: 'a',
});

const nothing: DocSearchPage = { hits: [], total: 0, next_cursor: null };
const zebra: DocSearchPage = {
  hits: [
    {
      id: 'plan',
      title: 'Plan',
      snippet: 'Meet at the <b>zebra</b> crossing',
      score: 1,
      archived: false,
    },
  ],
  total: 1,
  next_cursor: null,
};

// The peer's edit has reached this node's index by the time it is asked again.
let indexed = nothing;
const client = {
  searchDocs: vi.fn(async () => indexed),
} as unknown as DocsClient;
let rows = [row(1)];

vi.mock('@/context/WorkspaceIndexContext', () => ({
  useWorkspaceIndexValue: () => ({
    rows,
    folders: [{ id: 'f1', name: 'One' }],
    folderStatus: { f1: 'ready' },
    contextOf: () => 'ctx-f1',
    clientOf: () => client,
  }),
}));

describe('useDocSearch', () => {
  it("asks again once a folder's docs change, keeping the old hits meanwhile", async () => {
    const { result, rerender } = renderHook(() => useDocSearch('zebra'));
    await waitFor(() => expect(result.current.served.has('f1')).toBe(true));
    expect(result.current.hits).toEqual([]);

    // A peer types the word; the edit syncs in and the doc's row moves.
    indexed = zebra;
    rows = [row(2)];
    rerender();
    expect(result.current.served.has('f1')).toBe(true);
    await waitFor(
      () => expect(result.current.hits.map((h) => h.docId)).toEqual(['plan']),
      { timeout: INDEX_CATCH_UP_MS * 3 },
    );
    expect(result.current.hits[0].ranges).toEqual([[12, 17]]);
    expect(vi.mocked(client.searchDocs)).toHaveBeenCalledTimes(2);
  });
});
