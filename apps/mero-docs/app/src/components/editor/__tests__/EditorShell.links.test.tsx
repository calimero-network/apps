// The shell's own paste handler on a live editor, and that index updates reach
// the editor's link handlers without re-rendering the whole shell.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EditorShell } from '../EditorShell';
import type { DriveEditor } from '../blocknote/schema';
import type { IndexRow } from '@/lib/workspaceIndex/types';

const h = vi.hoisted(() => ({
  statusBarDraws: 0,
  rows: [] as unknown[],
  listeners: new Set<() => void>(),
}));

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('@blocknote/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@blocknote/react')>()),
  SideMenuController: () => null,
  LinkToolbarController: () => null,
  FormattingToolbarController: () => null,
}));
vi.mock('../blocknote/DocLinkPicker', () => ({ DocLinkPicker: () => null }));
vi.mock('../blocknote/EditorSlashMenu', () => ({
  EditorSlashMenu: () => null,
}));
vi.mock('../EditorHeader', () => ({ EditorHeader: () => null }));
vi.mock('../EditorStatusBar', () => ({
  EditorStatusBar: () => {
    h.statusBarDraws++;
    return null;
  },
}));
vi.mock('@/components/theme/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'w1',
    registryFolders: null,
    selfIdentity: 'me',
    namespaceMemberNames: {},
  }),
}));
vi.mock('@/context/WorkspaceIndexContext', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (fn: () => void) => {
    h.listeners.add(fn);
    return () => h.listeners.delete(fn);
  };
  const snapshot = (rows: unknown[]) => ({
    rows,
    folders: [],
    foldersKnown: false,
    folderStatus: {},
    refetchFolder: () => {},
    contextOf: () => undefined,
  });
  let last = snapshot(h.rows);
  return {
    useWorkspaceIndexValue: () =>
      useSyncExternalStore(subscribe, () => {
        if (last.rows !== h.rows) last = snapshot(h.rows);
        return last;
      }),
    useTextIndexValue: () => ({ texts: new Map() }),
  };
});

const ORIGIN = window.location.origin;

function row(docId: string, title: string): IndexRow {
  return {
    folderId: 'f1',
    docId,
    title,
    tags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    createdBy: 'me',
    updatedBy: 'me',
  };
}

function setIndexRows(rows: IndexRow[]) {
  act(() => {
    h.rows = rows;
    h.listeners.forEach((fn) => fn());
  });
}

async function mountShell(): Promise<DriveEditor> {
  let editor: DriveEditor | null = null;
  render(
    <MemoryRouter initialEntries={['/app/w1/f/f1/d/d1']}>
      <EditorShell
        documentName="Plan"
        onEditorReady={(ready) => {
          editor = ready;
        }}
      />
    </MemoryRouter>,
  );
  await vi.waitFor(() => expect(editor).not.toBeNull());
  const ready = editor as unknown as DriveEditor;
  ready.mount(document.body.appendChild(document.createElement('div')));
  return ready;
}

function typeAtEnd(editor: DriveEditor, text: string) {
  editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: text }]);
  editor.setTextCursorPosition(editor.document[0].id, 'end');
}

function paste(editor: DriveEditor, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types: ['text/plain'],
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    },
  });
  editor.prosemirrorView!.dom.dispatchEvent(event);
}

afterEach(() => {
  h.rows = [];
  h.statusBarDraws = 0;
});

describe('EditorShell doc links', () => {
  it('pastes a doc URL as its title, keeping a [ typed just before', async () => {
    h.rows = [row('d2', 'Pricing notes')];
    const editor = await mountShell();
    typeAtEnd(editor, 'see [');

    paste(editor, `${ORIGIN}/app/w1/f/f1/d/d2`);

    expect(editor.document[0].content).toEqual([
      { type: 'text', text: 'see [', styles: {} },
      {
        type: 'link',
        href: '/app/w1/f/f1/d/d2',
        content: [{ type: 'text', text: 'Pricing notes', styles: {} }],
      },
    ]);
    editor.unmount();
  });

  it('follows index updates without re-rendering the shell', async () => {
    const editor = await mountShell();
    // The edit's own count update lands inside this act, not the next one.
    act(() => typeAtEnd(editor, 'see '));
    const before = h.statusBarDraws;

    setIndexRows([row('d3', 'Budget')]);

    expect(h.statusBarDraws).toBe(before);
    paste(editor, `${ORIGIN}/app/w1/f/f1/d/d3`);
    expect(editor.document[0].content).toEqual([
      { type: 'text', text: 'see ', styles: {} },
      {
        type: 'link',
        href: '/app/w1/f/f1/d/d3',
        content: [{ type: 'text', text: 'Budget', styles: {} }],
      },
    ]);
    editor.unmount();
  });
});
