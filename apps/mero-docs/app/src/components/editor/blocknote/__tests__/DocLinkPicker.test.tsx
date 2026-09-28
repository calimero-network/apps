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
  useDriveWorkspace: () => ({ namespaceId: 'w1' }),
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
});
