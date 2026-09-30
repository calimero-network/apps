import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DocsClient } from '@/generated/docs/DocsClient';
import { docTextFromBlocks } from '@/lib/search/docText';
import { rowKey, type IndexRow } from '@/lib/workspaceIndex/types';
import { useTextMatch } from '../useTextMatch';

const row = (folderId: string, docId: string, title: string): IndexRow => ({
  folderId,
  docId,
  title,
  tags: [],
  archived: false,
  createdAt: 0,
  updatedAt: 0,
  createdBy: 'a',
  updatedBy: 'a',
});

const rows = [
  row('f1', 'a', 'Notes'),
  row('f1', 'b', 'Budget'),
  row('f1', 'c', 'Other'),
  row('f2', 'd', 'Minutes'),
];

// f1's node answers from its index; f2's runs with search off.
const f1 = {
  searchDocs: vi.fn(async () => ({
    hits: [{ id: 'a', title: 'Notes', snippet: '', score: 1, archived: false }],
    total: 1,
    next_cursor: null,
  })),
} as unknown as DocsClient;
const f2 = {
  searchDocs: vi.fn(async () => {
    throw new Error(
      'search_query is only available in a view on a node with search',
    );
  }),
} as unknown as DocsClient;

const texts = new Map([
  [
    rowKey('f2', 'd'),
    docTextFromBlocks(
      'f2',
      'd',
      [
        {
          id: 'p',
          kind: 'paragraph',
          depth: 0,
          attrs: {},
          spans: [{ text: 'the budget' }],
        },
      ],
      'http://x',
    ),
  ],
  [
    // Read here before the index answered; the index now decides for f1.
    rowKey('f1', 'c'),
    docTextFromBlocks(
      'f1',
      'c',
      [
        {
          id: 'p',
          kind: 'paragraph',
          depth: 0,
          attrs: {},
          spans: [{ text: 'old budget' }],
        },
      ],
      'http://x',
    ),
  ],
]);

vi.mock('@/context/WorkspaceIndexContext', () => ({
  useWorkspaceIndexValue: () => ({
    rows,
    folders: [
      { id: 'f1', name: 'One' },
      { id: 'f2', name: 'Two' },
    ],
    folderStatus: { f1: 'ready', f2: 'ready' },
    contextOf: (id: string) => `ctx-${id}`,
    clientOf: (id: string) => (id === 'f1' ? f1 : f2),
  }),
  useTextIndexValue: () => ({ texts }),
}));

describe('useTextMatch', () => {
  it("takes an indexed folder's body matches from its index, the rest from text read here", async () => {
    const { result } = renderHook(() => useTextMatch());
    // Before any index answers: titles, and the text read here.
    expect([...result.current('budget')].sort()).toEqual(
      [rowKey('f1', 'b'), rowKey('f1', 'c'), rowKey('f2', 'd')].sort(),
    );
    await waitFor(() =>
      expect([...result.current('budget')].sort()).toEqual(
        // f1: its title match and the index's hit; f2: the text read here.
        [rowKey('f1', 'a'), rowKey('f1', 'b'), rowKey('f2', 'd')].sort(),
      ),
    );
    expect(vi.mocked(f1.searchDocs)).toHaveBeenCalledWith({
      query: 'budget',
      include_archived: true,
      cursor: null,
      limit: 100,
    });
  });
});
