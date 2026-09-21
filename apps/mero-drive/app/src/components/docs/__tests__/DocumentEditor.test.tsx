import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { DocDto } from '@/generated/docs/DocsClient';
import { DocumentEditor } from '../DocumentEditor';

const getDoc = vi.fn();
let onContextEvent: (() => void) | undefined;

vi.mock('@/constants/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/constants/config')>()),
  COLLAB_YJS_ENABLED: false,
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ namespaceId: 'ns' }),
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({ canEditDocs: true }),
}));
vi.mock('@/hooks/useDocs', () => ({
  useDocs: () => ({
    get: getDoc,
    edit: vi.fn(),
    remove: vi.fn(),
    contextId: 'docs-ctx',
  }),
}));
vi.mock('@/hooks/useContextEvents', () => ({
  useContextEvents: (_ctx: string | null, cb: () => void) => {
    onContextEvent = cb;
  },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock('@/components/editor/EditorShell', () => ({
  EditorShell: ({ isLoading }: { isLoading: boolean }) => (
    <div>{isLoading ? 'Loading document...' : 'editor mounted'}</div>
  ),
}));

const DOC: DocDto = {
  id: 'doc-1',
  title: 'Untitled',
  content: '',
  updated_at: 1_700_000_000_000_000_000,
} as DocDto;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('LwwDocumentEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onContextEvent = undefined;
  });

  it('leaves the loading screen when a context event refresh supersedes the initial load', async () => {
    const initial = deferred<DocDto>();
    const refresh = deferred<DocDto>();
    getDoc
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(refresh.promise);

    render(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} />);
    expect(screen.getByText('Loading document...')).toBeTruthy();

    // create_doc's own event lands while the initial get_doc is in flight.
    act(() => onContextEvent?.());
    expect(getDoc).toHaveBeenCalledTimes(2);

    await act(async () => {
      initial.resolve(DOC);
      refresh.resolve(DOC);
    });

    expect(screen.getByText('editor mounted')).toBeTruthy();
  });
});
