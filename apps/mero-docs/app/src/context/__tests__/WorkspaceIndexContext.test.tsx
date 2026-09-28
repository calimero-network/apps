import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import {
  WorkspaceIndexProvider,
  useTextIndexValue,
} from '../WorkspaceIndexContext';
import { usePresenceByDoc, type PresenceByDoc } from '@/hooks/usePresenceByDoc';
import { useSavedViews } from '@/hooks/useSavedViews';
import type { FolderIndexStatus } from '@/hooks/useWorkspaceIndex';

const index = {
  rows: [],
  folders: [
    { id: 'f1', name: 'One' },
    { id: 'f2', name: 'Two' },
  ],
  folderStatus: {} as Record<string, FolderIndexStatus>,
  contextOf: (id: string) => `ctx-${id}`,
  refetchFolder: () => {},
};
const watched: string[] = [];
const textIndex = {
  texts: new Map(),
  foldersDone: 1,
  foldersTotal: 2,
  pending: ['f2'],
  failed: [],
};

vi.mock('@/hooks/useWorkspaceIndex', () => ({
  useWorkspaceIndex: () => index,
}));
vi.mock('@/hooks/useTextIndex', () => ({
  useTextIndex: () => textIndex,
}));
vi.mock('@/hooks/useTags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useTags')>()),
  useTagsSource: () => ({ tags: [], byKey: new Map() }),
}));
const savedViews = {
  views: [{ id: 'v1', name: 'Mine', query: 'tag=x', scope: 'me' as const }],
  save: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
};
vi.mock('@/hooks/useSavedViews', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useSavedViews')>()),
  useSavedViewsSource: () => savedViews,
}));
vi.mock('@/hooks/usePresenceByDoc', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('@/hooks/usePresenceByDoc')>();
  const byFolder: Record<string, PresenceByDoc> = {
    f1: new Map([['f1/a', [{ id: 'bob', name: 'Bob', colour: '#f00' }]]]),
    f2: new Map([['f2/b', [{ id: 'cy', name: 'Cy', colour: '#0f0' }]]]),
  };
  return {
    ...real,
    useFolderPresence: (folderId: string, contextId: string) => {
      watched.push(contextId);
      return byFolder[folderId];
    },
  };
});

let seen: PresenceByDoc = new Map();
let seenText: unknown = null;
let seenViews: unknown = null;
function Probe() {
  seen = usePresenceByDoc();
  seenText = useTextIndexValue();
  seenViews = useSavedViews();
  return null;
}

function mount() {
  return render(
    <WorkspaceIndexProvider>
      <Probe />
    </WorkspaceIndexProvider>,
  );
}

beforeEach(() => {
  watched.length = 0;
  seen = new Map();
});

describe('WorkspaceIndexProvider presence', () => {
  it('merges readers from every folder it has read', () => {
    index.folderStatus = { f1: 'ready', f2: 'ready' };
    mount();
    expect([...seen.keys()].sort()).toEqual(['f1/a', 'f2/b']);
  });

  it('watches no folder it has not joined, and forgets one that leaves', () => {
    index.folderStatus = { f1: 'ready', f2: 'syncing' };
    const { rerender } = mount();
    expect(watched).not.toContain('ctx-f2');
    expect([...seen.keys()]).toEqual(['f1/a']);

    index.folderStatus = { f1: 'error', f2: 'syncing' };
    rerender(
      <WorkspaceIndexProvider>
        <Probe />
      </WorkspaceIndexProvider>,
    );
    expect(seen.size).toBe(0);
  });
});

describe('WorkspaceIndexProvider text index', () => {
  it('hands search the text index it builds', () => {
    index.folderStatus = { f1: 'ready', f2: 'loading' };
    mount();
    expect(seenText).toBe(textIndex);
  });
});

describe('WorkspaceIndexProvider saved views', () => {
  it('hands Home and the sidebar the one saved views source it holds', () => {
    mount();
    expect(seenViews).toBe(savedViews);
  });
});
