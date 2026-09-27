// The editor's data-layer bridge, driven with a fake docs client. The trap
// this file guards is the loading screen: the shell must leave it once the
// document read resolves, whichever read wins the race.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DocDto } from '@/generated/docs/DocsClient';
import { DocumentEditor } from '../DocumentEditor';

const getDoc = vi.fn();
const getDocument = vi.fn();
const getTitle = vi.fn();
const docsRemove = vi.fn();
const toastError = vi.hoisted(() => vi.fn());
let deliver: ((event: unknown) => void) | undefined;
// Stable identity: useDocs memoizes its client, and a fresh one per render
// would re-run every hook effect that keys on it.
const client = { getDocument, getTitle };
// The folder's docs-context resolution, as useDocs reports it.
let contextState: {
  contextId: string | null;
  contextResolving: boolean;
  error: Error | null;
};

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({
  toast: { error: toastError, success: toastSuccess },
}));
vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: (_ids: string[], handler: (event: unknown) => void) => {
    deliver = handler;
  },
  useEphemeral: () => ({
    peers: new Map(),
    setPresence: vi.fn(),
    ageOf: () => undefined,
    error: null,
  }),
  useMero: () => ({ mero: null }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'ns',
    selfIdentity: 'alice',
    namespaceMemberNames: {},
  }),
}));
let location = { pathname: '/app/ns/f/f/d/doc-1', hash: '', key: 'nav-1' };
vi.mock('react-router-dom', () => ({ useLocation: () => location }));
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({ canEditDocs: true }),
}));
vi.mock('@/hooks/useDocs', () => ({
  useDocs: () => ({
    get: getDoc,
    edit: vi.fn(),
    remove: docsRemove,
    refetch: vi.fn(),
    ...contextState,
    client,
  }),
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));
vi.mock('@/components/editor/EditorShell', () => ({
  EditorShell: ({
    isLoading,
    documentName,
    onDelete,
    onCopyLink,
    isAppReady,
    isOffline,
    sectionLinks,
    focusBlock,
    focusKey,
  }: {
    isLoading: boolean;
    documentName: string;
    onDelete?: () => void;
    onCopyLink?: () => void;
    isAppReady: boolean;
    isOffline: boolean;
    sectionLinks?: {
      copy: (blockId: string, section: string) => void;
      isConfirmed: (blockId: string) => boolean;
    };
    focusBlock?: string;
    focusKey?: string;
  }) => (
    <div data-testid="shell" data-focus-block={focusBlock} data-focus-key={focusKey}>
      <span data-testid="connection">
        {isOffline ? 'offline' : isAppReady ? 'ready' : 'connecting'}
      </span>
      {isLoading ? 'Loading document...' : documentName}
      {onDelete && <button onClick={onDelete}>Delete</button>}
      {onCopyLink && <button onClick={onCopyLink}>Copy link</button>}
      {sectionLinks && (
        <button onClick={() => sectionLinks.copy('blk-9', 'Milestones')}>
          Copy link to section
        </button>
      )}
    </div>
  ),
}));

const DOC = {
  id: 'doc-1',
  title: 'Untitled',
  tags: [],
  archived: false,
  created_at: 1_700_000_000_000_000_000,
  updated_at: 1_700_000_000_000_000_000,
  created_by: 'a1'.repeat(32),
  updated_by: 'a1'.repeat(32),
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
  location = { pathname: '/app/ns/f/f/d/doc-1', hash: '', key: 'nav-1' };
  contextState = { contextId: 'docs-ctx', contextResolving: false, error: null };
  getDoc.mockResolvedValue(DOC);
  getTitle.mockResolvedValue('Notes');
  getDocument.mockResolvedValue([]);
});

describe('DocumentEditor', () => {
  it('shows the loading screen until the document read resolves', async () => {
    const body = deferred<unknown[]>();
    getDocument.mockReturnValue(body.promise);

    render(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} onDeleted={() => {}} />);
    expect(screen.getByText('Loading document...')).toBeTruthy();

    await act(async () => {
      body.resolve([]);
    });
    expect(screen.getByText('Notes')).toBeTruthy();
  });

  it('renders the title the title CRDT answered', async () => {
    render(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} onDeleted={() => {}} />);
    await screen.findByText('Notes');
    expect(getTitle).toHaveBeenCalledWith({ doc: 'doc-1' });
  });

  it('falls back to Untitled when the document has no title yet', async () => {
    getTitle.mockResolvedValue('');
    render(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} onDeleted={() => {}} />);
    await screen.findByText('Untitled');
  });

  it('subscribes to the docs context so a peer edit can reach it', async () => {
    render(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} onDeleted={() => {}} />);
    await screen.findByText('Notes');
    expect(deliver).toBeTypeOf('function');
  });

  it('surfaces a failed metadata read instead of an empty editor', async () => {
    getDoc.mockRejectedValue(new Error('context unreachable'));
    render(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} onDeleted={() => {}} />);
    await screen.findByText("Couldn't load document");
    expect(screen.getByText('context unreachable')).toBeTruthy();
  });

  it('toasts when the delete call fails, instead of failing silently', async () => {
    docsRemove.mockRejectedValue(new Error('delete boom'));
    const onDeleted = vi.fn();
    render(
      <DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} onDeleted={onDeleted} />,
    );
    await screen.findByText('Notes');

    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't delete document"),
    );
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('reports a successful delete as deleted, not as a close', async () => {
    docsRemove.mockResolvedValue(undefined);
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    render(
      <DocumentEditor
        folderId="f"
        docId="doc-1"
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    );
    await screen.findByText('Notes');

    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('copies the URL of this document in its folder', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} onDeleted={() => {}} />);
    await screen.findByText('Notes');

    fireEvent.click(screen.getByText('Copy link'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Link copied'));
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/app/ns/f/f/d/doc-1`,
    );
  });

  it('copies the URL of one block with a toast naming its section', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} onDeleted={() => {}} />);
    await screen.findByText('Notes');

    fireEvent.click(screen.getByText('Copy link to section'));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Link to "Milestones" copied'),
    );
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/app/ns/f/f/d/doc-1#b=blk-9`,
    );
  });

  it('hands the shell the block a #b= link names, with this navigation', async () => {
    location = { pathname: '/app/ns/f/f/d/doc-1', hash: '#b=blk-7', key: 'nav-2' };
    render(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} onDeleted={() => {}} />);
    await screen.findByText('Notes');
    const shell = screen.getByTestId('shell');
    expect(shell.dataset.focusBlock).toBe('blk-7');
    expect(shell.dataset.focusKey).toBe('nav-2');
  });

  it('focuses no block without a #b= link', async () => {
    render(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} onDeleted={() => {}} />);
    await screen.findByText('Notes');
    expect(screen.getByTestId('shell').dataset.focusBlock).toBeUndefined();
  });

  describe('connection state', () => {
    const connection = () => screen.getByTestId('connection').textContent;

    it('goes from connecting to offline once the folder context fails to resolve', () => {
      contextState = { contextId: null, contextResolving: true, error: null };
      const { rerender } = render(
        <DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} onDeleted={() => {}} />,
      );
      expect(connection()).toBe('connecting');

      contextState = { contextId: null, contextResolving: false, error: new Error('denied') };
      rerender(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} onDeleted={() => {}} />);
      expect(connection()).toBe('offline');
    });

    it('goes from connecting to ready once the folder context resolves', async () => {
      contextState = { contextId: null, contextResolving: true, error: null };
      const { rerender } = render(
        <DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} onDeleted={() => {}} />,
      );
      expect(connection()).toBe('connecting');

      contextState = { contextId: 'docs-ctx', contextResolving: false, error: null };
      rerender(<DocumentEditor folderId="f" docId="doc-1" onClose={() => {}} onDeleted={() => {}} />);
      expect(connection()).toBe('ready');
      await screen.findByText('Notes');
    });
  });
});
