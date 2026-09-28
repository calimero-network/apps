// The picker's wiring: which menus it registers, and when an open menu reloads.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DocLinkPicker } from '../DocLinkPicker';
import { DOC_LINK_TRIGGER, type DocLinkItem } from '../docLinks';
import { SECTION_LINK_TRIGGER } from '../slashMenu';
import type { DriveEditor } from '../schema';
import {
  rowKey,
  type DocText,
  type IndexRow,
} from '@/lib/workspaceIndex/types';

type Menu = {
  triggerCharacter: string;
  getItems: (query: string) => Promise<DocLinkItem[]>;
};

const h = vi.hoisted(() => ({
  menus: [] as Menu[],
  texts: new Map() as Map<string, DocText>,
  group: {
    members: [] as { identity: string }[],
    loading: false,
    error: null as Error | null,
  },
}));

vi.mock('@blocknote/react', () => ({
  SuggestionMenuController: (props: Menu) => {
    h.menus.push(props);
    return null;
  },
}));
vi.mock('@/context/WorkspaceIndexContext', () => ({
  useWorkspaceIndexValue: () => ({ rows: ROWS, folders: [] }),
  useTextIndexValue: () => ({ texts: h.texts }),
}));
vi.mock('@/hooks/useAppRoute', () => ({
  useAppRoute: () => ({ route: { folder: 'f1', doc: 'd1' } }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'w1',
    selfIdentity: 'me',
    namespaceMemberNames: { me: 'Mia', bob: 'Bob' },
  }),
}));
vi.mock('@calimero-network/mero-react', () => ({
  useGroupMembers: () => h.group,
}));
vi.mock('@/hooks/useFolderReach', () => ({
  useFolderReach: () => () => true,
}));

const ROWS: IndexRow[] = [
  {
    folderId: 'f1',
    docId: 'd1',
    title: 'Plan',
    tags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    createdBy: 'me',
    updatedBy: 'me',
  },
  {
    folderId: 'f1',
    docId: 'd2',
    title: 'Notes',
    tags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    createdBy: 'me',
    updatedBy: 'me',
  },
];

const headings = (...texts: string[]): Map<string, DocText> =>
  new Map([
    [
      rowKey('f1', 'd1'),
      {
        folderId: 'f1',
        docId: 'd1',
        blocks: texts.map((text, i) => ({
          id: `h${i}`,
          kind: 'heading',
          text,
        })),
        links: [],
        mentions: [],
      },
    ],
  ]);

const latest = (trigger: string): Menu => {
  const mine = h.menus.filter((m) => m.triggerCharacter === trigger);
  return mine[mine.length - 1];
};

afterEach(() => {
  h.menus = [];
  h.group = { members: [], loading: false, error: null };
});

describe('DocLinkPicker', () => {
  it('reloads an open section picker when the text index updates', async () => {
    const editor = {} as DriveEditor;
    h.texts = headings('Goals');
    const { rerender } = render(<DocLinkPicker editor={editor} />);
    const sections = latest(SECTION_LINK_TRIGGER).getItems;
    const docs = latest(DOC_LINK_TRIGGER).getItems;

    h.texts = headings('Goals', 'Rollout');
    rerender(<DocLinkPicker editor={editor} />);

    // BlockNote reloads an open menu's items when getItems changes.
    expect(latest(SECTION_LINK_TRIGGER).getItems).not.toBe(sections);
    expect(latest(DOC_LINK_TRIGGER).getItems).toBe(docs);
    const items = await latest(SECTION_LINK_TRIGGER).getItems('');
    expect(items.map((i) => i.title)).toEqual(['Goals', 'Rollout']);
  });

  it('keeps the last people it read while members reload or fail, and still lists documents', async () => {
    const editor = {} as DriveEditor;
    const people = async () =>
      (await latest(DOC_LINK_TRIGGER).getItems(''))
        .filter((i) => i.kind === 'person')
        .map((i) => i.title);
    h.group = {
      members: [{ identity: 'me' }, { identity: 'bob' }],
      loading: false,
      error: null,
    };
    const { rerender } = render(<DocLinkPicker editor={editor} />);
    expect(await people()).toEqual(['Bob', 'You']);

    h.group = { members: [], loading: true, error: null };
    rerender(<DocLinkPicker editor={editor} />);
    expect(await people()).toEqual(['Bob', 'You']);
    const docs = (await latest(DOC_LINK_TRIGGER).getItems('')).filter(
      (i) => i.kind === 'doc',
    );
    expect(docs.map((i) => i.title)).toEqual(['Notes']);

    h.group = { members: [], loading: false, error: new Error('offline') };
    rerender(<DocLinkPicker editor={editor} />);
    expect(await people()).toEqual(['Bob', 'You']);
  });

  it('leaves People out, with no error text, when members never loaded', async () => {
    const editor = {} as DriveEditor;
    h.group = { members: [], loading: false, error: new Error('offline') };
    const { container } = render(<DocLinkPicker editor={editor} />);
    const items = await latest(DOC_LINK_TRIGGER).getItems('');
    expect(items.some((i) => i.kind === 'person')).toBe(false);
    expect(container.textContent).toBe('');
  });
});
