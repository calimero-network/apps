// Every committed frame of a doc link, with the real useDocs and a docs
// client per context. The act environment is off so updates land as they would in a browser.
import React, { useLayoutEffect, useSyncExternalStore } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router-dom';
import { WorkspaceLayout } from '../WorkspaceLayout';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };

type Doc = { id: string; title: string; updated_at: number };

const h = vi.hoisted(() => {
  function deferred<T>(): Deferred<T> {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }
  const listeners = new Set<() => void>();
  let state = {
    resolvedFolderIds: new Set<string>(),
  };
  return {
    deferred,
    contexts: new Map<string, Deferred<string>>(),
    // Queued answers per docs context; once drained, the last answer repeats.
    reads: new Map<string, Deferred<Doc[]>[]>(),
    lastRead: new Map<string, Doc[]>(),
    read(ctx: string) {
      const d = deferred<Doc[]>();
      const q = h.reads.get(ctx) ?? [];
      q.push(d);
      h.reads.set(ctx, q);
      return d;
    },
    cards: [] as string[],
    get state() {
      return state;
    },
    set(next: Partial<typeof state>) {
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    registryClient: {
      getFolderContext: ({ folder_id }: { folder_id: string }) =>
        h.contexts.get(folder_id)!.promise,
    },
    fixed: {
      namespaces: [{ namespaceId: 'ns' }],
      registryFolders: [
        { id: 'f1', parent_id: null, color: null, alias: 'One' },
        { id: 'f2', parent_id: null, color: null, alias: 'Two' },
      ],
      hiddenFolderIds: new Set<string>(),
      folders: [],
      noop: () => {},
      refetch: () => Promise.resolve(),
      mero: { mero: {}, nodeUrl: 'http://node', logout: () => {} },
      join: { joinContext: () => Promise.resolve() },
    },
  };
});

vi.mock('@/hooks/useDriveWorkspace', async () => {
  const { useAppRoute } = await import('@/hooks/useAppRoute');
  return {
    useDriveWorkspace: () => {
      const s = useSyncExternalStore(h.subscribe, () => h.state);
      const { route } = useAppRoute();
      return {
        namespaceId: route?.ws ?? null,
        namespaces: h.fixed.namespaces,
        namespacesListed: true,
        isJustJoined: false,
        registryContextId: 'reg',
        registryClient: h.registryClient,
        selectedFolderId: route?.folder ?? null,
        setSelectedFolder: h.fixed.noop,
        folders: h.fixed.folders,
        registryFolders: h.fixed.registryFolders,
        resolvedFolderIds: s.resolvedFolderIds,
        hiddenFolderIds: h.fixed.hiddenFolderIds,
        selfIdentity: 'me',
        namespaceMemberNames: {},
        stage: 'ready',
        syncStatus: null,
        refetch: h.fixed.refetch,
      };
    },
  };
});
vi.mock('@/generated/docs/DocsClient', () => ({
  DocsClient: class {
    constructor(
      _mero: unknown,
      private ctx: string,
    ) {}
    listDocs() {
      const next = h.reads.get(this.ctx)?.shift();
      if (!next) return Promise.resolve(h.lastRead.get(this.ctx) ?? []);
      return next.promise.then((docs) => {
        h.lastRead.set(this.ctx, docs);
        return docs;
      });
    }
  },
}));
vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => h.fixed.mero,
  useJoinContext: () => h.fixed.join,
}));
vi.mock('@/hooks/useContextEvents', () => ({ useContextEvents: () => {} }));
vi.mock('../LinkTargetCard', () => ({
  LinkTargetCard: ({ kind }: { kind: string }) => {
    useLayoutEffect(() => {
      h.cards.push(kind);
    });
    return <div data-testid="card">{kind}</div>;
  },
}));
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('@/hooks/useWorkspacePresence', () => ({
  usePublishWorkspacePresence: () => {},
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({ loading: false, caps: 0, refetch: vi.fn() }),
}));
// The layout's own screens are under test; the index has its own suite.
vi.mock('@/context/WorkspaceIndexContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/WorkspaceIndexContext')>()),
  WorkspaceIndexProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/theme/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('../NamespaceSwitcher', () => ({ NamespaceSwitcher: () => null }));
vi.mock('../DisplayNameGate', () => ({ DisplayNameGate: () => null }));
vi.mock('../NamespaceSettingsPanel', () => ({ NamespaceSettingsPanel: () => null }));
vi.mock('@/components/docs/DocumentEditor', () => ({
  DocumentEditor: ({ docId }: { docId: string }) => (
    <div data-testid="editor">{docId}</div>
  ),
}));
vi.mock('@/components/folders/FolderTree', () => ({ FolderTree: () => null }));

window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: true,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

const tick = () => new Promise((r) => setTimeout(r, 0));
const doc = (id: string) => ({ id, title: id, updated_at: 1 });

let navigate: NavigateFunction;
function Nav() {
  navigate = useNavigate();
  return null;
}

function renderAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/app/*"
          element={
            <>
              <WorkspaceLayout />
              <Nav />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
    { wrapper: ConfirmProvider },
  );
}

async function openColdDoc() {
  const firstRead = h.read('ctx1');
  renderAt('/app/ns/f/f1/d/doc-1');
  await tick();
  h.set({ resolvedFolderIds: new Set(['f1', 'f2']) });
  await tick();
  h.contexts.get('f1')!.resolve('ctx1');
  await tick();
  firstRead.resolve([doc('doc-1')]);
  await waitFor(() => expect(screen.getByTestId('editor').textContent).toBe('doc-1'));
}

let actEnv: unknown;
beforeAll(() => {
  actEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = false;
});
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = actEnv;
});
afterEach(() => {
  cleanup();
  h.cards.length = 0;
  h.set({ resolvedFolderIds: new Set() });
  for (const f of ['f1', 'f2']) h.contexts.set(f, h.deferred());
  h.reads.clear();
  h.lastRead.clear();
});
for (const f of ['f1', 'f2']) h.contexts.set(f, h.deferred());

describe('WorkspaceLayout doc link frames', () => {
  it('never commits a deleted card on a cold open of a doc link', async () => {
    await openColdDoc();
    expect(h.cards).not.toContain('deleted');
  });

  it('never commits a deleted card when a link moves to a doc in another folder', async () => {
    await openColdDoc();
    h.cards.length = 0;
    const read = h.read('ctx2');
    navigate('/app/ns/f/f2/d/doc-2');
    await tick();
    h.contexts.get('f2')!.resolve('ctx2');
    await tick();
    read.resolve([doc('doc-2')]);
    await waitFor(() => expect(screen.getByTestId('editor').textContent).toBe('doc-2'));
    expect(h.cards).not.toContain('deleted');
  });

  it('re-reads instead of committing a deleted card for a doc the cached list predates', async () => {
    await openColdDoc();
    h.cards.length = 0;
    const read = h.read('ctx1');
    navigate('/app/ns/f/f1/d/just-made');
    await tick();
    read.resolve([doc('doc-1'), doc('just-made')]);
    await waitFor(() => expect(screen.getByTestId('editor').textContent).toBe('just-made'));
    expect(h.cards).not.toContain('deleted');
  });

  it('still says deleted when a fresh read confirms the doc is gone', async () => {
    await openColdDoc();
    const read = h.read('ctx1');
    navigate('/app/ns/f/f1/d/gone');
    await tick();
    read.resolve([doc('doc-1')]);
    await waitFor(() => expect(screen.getByTestId('card').textContent).toBe('deleted'));
  });
});
