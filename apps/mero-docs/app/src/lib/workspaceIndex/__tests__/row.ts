import type { IndexRow } from '../types';

/** An index row with plain defaults, for tests. */
export function row(partial: Partial<IndexRow> & { docId: string }): IndexRow {
  return {
    folderId: 'f1',
    title: partial.docId,
    tags: [],
    archived: false,
    createdAt: 0,
    updatedAt: 0,
    createdBy: 'alice',
    updatedBy: 'alice',
    ...partial,
  };
}
