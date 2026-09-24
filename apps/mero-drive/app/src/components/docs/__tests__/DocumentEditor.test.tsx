// The editor's data-layer bridge, driven with a fake docs client. The trap
// this file guards is the loading screen: the shell must leave it once the
// document read resolves, whichever read wins the race.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { DocDto } from '@/generated/docs/DocsClient';
import { DocumentEditor } from '../DocumentEditor';

const getDoc = vi.fn();
const getDocument = vi.fn();
const getTitle = vi.fn();
let deliver: ((event: unknown) => void) | undefined;
// Stable identity: useDocs memoizes its client, and a fresh one per render
// would re-run every hook effect that keys on it.
const client = { getDocument, getTitle };

vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: (_ids: string[], handler: (event: unknown) => void) => {
    deliver = handler;
  },
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'ns',
    selfIdentity: 'alice',
    namespaceMemberNames: {},
  }),
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({ canEditDocs: true }),
}));
vi.mock('@/hooks/useDocs', () => ({
  useDocs: () => ({
    get: getDoc,
    edit: vi.fn(),
    remove: vi.fn(),
    refetch: vi.fn(),
    contextId: 'docs-ctx',
    client,
  }),
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock('@/components/editor/EditorShell', () => ({
  EditorShell: ({
    isLoading,
    documentName,
  }: {
    isLoading: boolean;
    documentName: string;
  }) => <div>{isLoading ? 'Loading document...' : documentName}</div>,
}));

const DOC = {
  id: 'doc-1',
  title: 'Untitled',
  tags: [],
  archived: false,
  created_at: 1_700_000_000_000_000_000,
  updated_at: 1_700_000_000_000_000_000,
} satisfies DocDto;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  deliver = undefined;
  getDoc.mockResolvedValue(DOC);
  getTitle.mockResolvedValue('Notes');
  getDocument.mockResolvedValue([]);
});

describe('DocumentEditor', () => {
  it('shows the loading screen until the document read resolves', async () => {
    const body = deferred<unknown[]>();
    getDocument.mockReturnValue(body.promise);

    render(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} />);
    expect(screen.getByText('Loading document...')).toBeTruthy();

    await act(async () => {
      body.resolve([]);
    });
    expect(screen.getByText('Notes')).toBeTruthy();
  });

  it('renders the title the title CRDT answered', async () => {
    render(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} />);
    await screen.findByText('Notes');
    expect(getTitle).toHaveBeenCalledWith({ doc: 'doc-1' });
  });

  it('falls back to Untitled when the document has no title yet', async () => {
    getTitle.mockResolvedValue('');
    render(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} />);
    await screen.findByText('Untitled');
  });

  it('subscribes to the docs context so a peer edit can reach it', async () => {
    render(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} />);
    await screen.findByText('Notes');
    expect(deliver).toBeTypeOf('function');
  });

  it('surfaces a failed metadata read instead of an empty editor', async () => {
    getDoc.mockRejectedValue(new Error('context unreachable'));
    render(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} />);
    await screen.findByText("Couldn't load document");
    expect(screen.getByText('context unreachable')).toBeTruthy();
  });
});
