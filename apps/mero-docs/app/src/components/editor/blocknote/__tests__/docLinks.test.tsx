// Doc links against a live headless editor where the editor matters (the [[
// trigger and the inserted link), and as plain data everywhere else.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCreateBlockNote } from '@blocknote/react';
import { SuggestionMenu } from '@blocknote/core/extensions';
import { schema, type DriveEditor } from '../schema';
import {
  DOC_LINK_TRIGGER,
  docLinkItems,
  followDocLink,
  insertDocLink,
  openClickedLink,
  opensDocPicker,
  pastedDocLink,
  type LinkNav,
} from '../docLinks';
import {
  rowKey,
  type DocText,
  type IndexRow,
} from '@/lib/workspaceIndex/types';

const ORIGIN = 'http://localhost:5173';

function row(
  folderId: string,
  docId: string,
  title: string,
  over: Partial<IndexRow> = {},
): IndexRow {
  return {
    folderId,
    docId,
    title,
    tags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    createdBy: 'me',
    updatedBy: 'me',
    ...over,
  };
}

function text(
  folderId: string,
  docId: string,
  blocks: [string, string][],
): DocText {
  return {
    folderId,
    docId,
    blocks: blocks.map(([id, t]) => ({ id, kind: 'paragraph', text: t })),
    links: [],
  };
}

function editorWith(content: string): DriveEditor {
  const { result } = renderHook(() => useCreateBlockNote({ schema }));
  const editor = result.current as DriveEditor;
  editor.replaceBlocks(editor.document, [{ type: 'paragraph', content }]);
  editor.setTextCursorPosition(editor.document[0].id, 'end');
  return editor;
}

describe('opensDocPicker (L-11)', () => {
  it('does nothing for a single [', () => {
    const editor = editorWith('see ');
    expect(editor.transact((tr) => opensDocPicker(tr))).toBe(false);
  });

  it('opens when the [ just typed follows another [', () => {
    const editor = editorWith('see [');
    expect(editor.transact((tr) => opensDocPicker(tr))).toBe(true);
  });

  it('opens on the second [ as BlockNote handles typing, mid-line', () => {
    // The menu measures its anchor, which jsdom leaves unimplemented.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      toJSON: () => ({}),
    } as DOMRect);
    const editor = editorWith('see ');
    editor.mount(document.body.appendChild(document.createElement('div')));
    const menus = editor.getExtension(SuggestionMenu)!;
    menus.addSuggestionMenu({
      triggerCharacter: DOC_LINK_TRIGGER,
      shouldOpen: opensDocPicker,
    });
    const view = editor.prosemirrorView!;
    const type = (ch: string) => {
      const at = view.state.selection.from;
      const handled = view.someProp('handleTextInput', (f) =>
        f(view, at, at, ch, () => view.state.tr),
      );
      if (!handled) view.dispatch(view.state.tr.insertText(ch));
    };
    type('[');
    expect(menus.store.state?.show).toBeFalsy();
    type('[');
    type('p');
    expect(menus.store.state).toMatchObject({ show: true, query: 'p' });
    editor.unmount();
    vi.restoreAllMocks();
  });

  it('opens at the start of a block too', () => {
    const editor = editorWith('[');
    expect(editor.transact((tr) => opensDocPicker(tr))).toBe(true);
  });
});

describe('insertDocLink (L-12, L-13)', () => {
  it('replaces the leftover [ with the title linked to the doc', () => {
    // The menu has already removed the trigger [ and the query; one [ is left.
    const editor = editorWith('see [');
    insertDocLink(editor, {
      href: '/app/w1/f/f1/d/d2',
      title: 'Pricing notes',
    });
    expect(editor.document[0].content).toEqual([
      { type: 'text', text: 'see ', styles: {} },
      {
        type: 'link',
        href: '/app/w1/f/f1/d/d2',
        content: [{ type: 'text', text: 'Pricing notes', styles: {} }],
      },
    ]);
  });

  it('keeps text before the caret that is not a [', () => {
    const editor = editorWith('see ');
    insertDocLink(editor, { href: '/app/w1/f/f1/d/d2#b=b7', title: 'Plan' });
    expect(editor.document[0].content).toEqual([
      { type: 'text', text: 'see ', styles: {} },
      {
        type: 'link',
        href: '/app/w1/f/f1/d/d2#b=b7',
        content: [{ type: 'text', text: 'Plan', styles: {} }],
      },
    ]);
  });

  it('leaves the caret after the link so typing continues as plain text', () => {
    const editor = editorWith('see [');
    insertDocLink(editor, { href: '/app/w1/f/f1/d/d2', title: 'Plan' });
    editor.insertInlineContent([' next'], { updateSelection: true });
    expect(editor.document[0].content).toEqual([
      { type: 'text', text: 'see ', styles: {} },
      {
        type: 'link',
        href: '/app/w1/f/f1/d/d2',
        content: [{ type: 'text', text: 'Plan', styles: {} }],
      },
      { type: 'text', text: ' next', styles: {} },
    ]);
  });
});

describe('docLinkItems (L-11, L-13)', () => {
  const rows = [
    row('f1', 'd1', 'Q3 launch plan', { updatedAt: 30 }),
    row('f1', 'd2', 'Pricing notes', { updatedAt: 10 }),
    row('f2', 'd3', 'Design review notes', { updatedAt: 20 }),
    row('f2', 'd4', 'Pricing archive', { archived: true }),
  ];
  const texts = new Map(
    [
      text('f1', 'd1', [['b1', 'Pricing lives elsewhere']]),
      text('f2', 'd3', [
        ['b0', 'Intro'],
        ['b9', 'The pricing page'],
      ]),
      text('f2', 'd4', [['b2', 'pricing in the archive']]),
    ].map((t) => [rowKey(t.folderId, t.docId), t]),
  );
  const paths = new Map([
    ['f1', { names: ['Product'], ids: ['f1'] }],
    ['f2', { names: ['Product', 'Design'], ids: ['f1', 'f2'] }],
  ]);
  const src = {
    ws: 'w1',
    current: { folder: 'f1', doc: 'd1' },
    rows,
    texts,
    paths,
  };

  it('lists title matches, then text matches linking to the block', () => {
    const items = docLinkItems('pric', src);
    expect(items.map((i) => [i.kind, i.title, i.href, i.folderLabel])).toEqual([
      ['doc', 'Pricing notes', '/app/w1/f/f1/d/d2', 'Product'],
      [
        'text',
        'Design review notes',
        '/app/w1/f/f2/d/d3#b=b9',
        'Product / Design',
      ],
    ]);
    expect(items[0].titleRanges).toEqual([{ start: 0, end: 4 }]);
    expect(items[1].quote).toBe('The pricing page');
    expect(items[1].quoteRanges).toEqual([{ start: 4, end: 8 }]);
  });

  it('never offers the doc being edited or an archived doc', () => {
    const ids = docLinkItems('pric', src).map((i) => i.href);
    expect(ids.some((h) => h.includes('/d/d1'))).toBe(false);
    expect(ids.some((h) => h.includes('/d/d4'))).toBe(false);
  });

  it('offers the most recently updated docs before anything is typed', () => {
    expect(docLinkItems('', src).map((i) => i.title)).toEqual([
      'Design review notes',
      'Pricing notes',
    ]);
  });

  it('is empty when nothing matches', () => {
    expect(docLinkItems('zzz', src)).toEqual([]);
  });
});

describe('pastedDocLink (L-15)', () => {
  const rows = new Map([
    [rowKey('f1', 'd2'), row('f1', 'd2', 'Pricing notes')],
  ]);
  const ctx = { origin: ORIGIN, ws: 'w1', rows };

  it('turns a doc URL from this workspace into a link titled with the doc', () => {
    expect(pastedDocLink(` ${ORIGIN}/app/w1/f/f1/d/d2 `, ctx)).toEqual({
      href: '/app/w1/f/f1/d/d2',
      title: 'Pricing notes',
    });
  });

  it('accepts the deployed app and keeps a section', () => {
    expect(
      pastedDocLink('https://mero-docs.vercel.app/app/w1/f/f1/d/d2#b=b3', ctx),
    ).toEqual({ href: '/app/w1/f/f1/d/d2#b=b3', title: 'Pricing notes' });
  });

  it('titles an unknown doc with the URL itself', () => {
    const url = `${ORIGIN}/app/w1/f/f1/d/gone`;
    expect(pastedDocLink(url, ctx)).toEqual({
      href: '/app/w1/f/f1/d/gone',
      title: url,
    });
  });

  it('leaves another workspace, other sites and prose to the default paste', () => {
    expect(pastedDocLink(`${ORIGIN}/app/w2/f/f1/d/d2`, ctx)).toBeNull();
    expect(
      pastedDocLink('https://example.com/app/w1/f/f1/d/d2', ctx),
    ).toBeNull();
    expect(pastedDocLink(`see ${ORIGIN}/app/w1/f/f1/d/d2`, ctx)).toBeNull();
    expect(pastedDocLink('', ctx)).toBeNull();
    expect(
      pastedDocLink(`${ORIGIN}/app/w1/f/f1/d/d2`, { ...ctx, ws: undefined }),
    ).toBeNull();
  });
});

describe('followDocLink (L-16, L-17)', () => {
  afterEach(() => vi.restoreAllMocks());

  function nav() {
    return {
      origin: ORIGIN,
      ws: 'w1',
      goDoc: vi.fn<LinkNav['goDoc']>(),
      navigate: vi.fn<LinkNav['navigate']>(),
      href: (route: Parameters<LinkNav['href']>[0]) =>
        `/app/${route.ws}/f/${route.folder}/d/${route.doc}?node=2${route.block ? `#b=${route.block}` : ''}`,
    };
  }

  function click(href: string, over: Partial<MouseEvent> = {}) {
    const a = document.createElement('a');
    a.setAttribute('href', href);
    const span = document.createElement('span');
    a.appendChild(span);
    return {
      target: span,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      button: 0,
      preventDefault: vi.fn(),
      ...over,
    } as unknown as MouseEvent;
  }

  it('opens a doc link inside the app, at its section', () => {
    const n = nav();
    const event = click('/app/w1/f/f1/d/d2#b=b3');
    expect(followDocLink(event, n)).toBe(true);
    expect(n.goDoc).toHaveBeenCalledWith('f1', 'd2', { block: 'b3' });
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it.each([
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['middle', { button: 1 }],
  ])('opens a new tab on a %s click', (_name, over) => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const n = nav();
    expect(followDocLink(click('/app/w1/f/f1/d/d2', over), n)).toBe(true);
    expect(open).toHaveBeenCalledWith(
      '/app/w1/f/f1/d/d2?node=2',
      '_blank',
      'noopener',
    );
    expect(n.goDoc).not.toHaveBeenCalled();
  });

  it('opens another workspace inside the app by its path', () => {
    const n = nav();
    expect(followDocLink(click('/app/w2/f/f1/d/d2'), n)).toBe(true);
    expect(n.navigate).toHaveBeenCalledWith('/app/w2/f/f1/d/d2?node=2');
  });

  it('leaves an external link to the caller', () => {
    const n = nav();
    const event = click('https://example.com/x');
    expect(followDocLink(event, n)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(n.goDoc).not.toHaveBeenCalled();
  });

  it('ignores the context-menu button', () => {
    const n = nav();
    const event = click('/app/w1/f/f1/d/d2', { button: 2 });
    expect(followDocLink(event, n)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(n.goDoc).not.toHaveBeenCalled();
  });

  it('opens an external link in a new tab from the editor', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openClickedLink(click('https://example.com/x'), nav())).toBe(true);
    expect(open).toHaveBeenCalledWith(
      'https://example.com/x',
      '_blank',
      'noopener',
    );
  });

  it('opens a doc link from the editor inside the app, not in a tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const n = nav();
    openClickedLink(click('/app/w1/f/f1/d/d2'), n);
    expect(n.goDoc).toHaveBeenCalledWith('f1', 'd2', { block: undefined });
    expect(open).not.toHaveBeenCalled();
  });
});
