import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import { inlineToText } from '../content';
import { DOC_LINK_TRIGGER, insertDocLink, opensDocPicker } from '../docLinks';
import {
  SECTION_LINK_TRIGGER,
  SLASH_TRIGGER,
  slashMenuItems,
  typedNever,
} from '../slashMenu';
import { editorWith, typingEditor } from './editorTyping';

afterEach(() => vi.restoreAllMocks());

const MENUS = [
  { triggerCharacter: SLASH_TRIGGER },
  { triggerCharacter: DOC_LINK_TRIGGER, shouldOpen: opensDocPicker },
  { triggerCharacter: SECTION_LINK_TRIGGER, shouldOpen: typedNever },
];

const titled = (editor: ReturnType<typeof editorWith>, title: string) =>
  slashMenuItems(editor).find((item) => item.title === title)!;

describe('slashMenuItems', () => {
  it('keeps the default blocks, titled in sentence case', () => {
    const items = slashMenuItems(editorWith(''));
    const titles = items.map((item) => item.title);
    expect(titles).toEqual(
      expect.arrayContaining(['Heading 1', 'Bullet list', 'Paragraph']),
    );
    for (const item of items) {
      expect(item.title.slice(1)).toBe(item.title.slice(1).toLowerCase());
      expect(item.group.slice(1)).toBe(item.group.slice(1).toLowerCase());
    }
  });

  it('names shortcuts by modifier, not by platform', () => {
    const editor = editorWith('');
    expect(titled(editor, 'Heading 1').shortcut).toBe('Mod-Alt-1');
    expect(titled(editor, 'Bullet list').shortcut).toBe('Mod-Shift-8');
  });

  it('ends with a Links group found by its aliases', () => {
    const items = slashMenuItems(editorWith(''));
    expect(items.slice(-2).map((i) => [i.group, i.title])).toEqual([
      ['Links', 'Link to a document'],
      ['Links', 'Link to a section'],
    ]);
    const found = (query: string) =>
      filterSuggestionItems(items, query).map((i) => i.title);
    for (const query of ['link', 'doc', 'page', 'mention']) {
      expect(found(query)).toContain('Link to a document');
    }
    for (const query of ['link', 'section', 'heading']) {
      expect(found(query)).toContain('Link to a section');
    }
  });

  it('opens the doc picker from the slash menu without a stray character', () => {
    const { editor, menus, type, pick } = typingEditor('see ', MENUS);
    type('/lin');
    expect(menus.store.state).toMatchObject({ show: true, query: 'lin' });
    pick();
    titled(editor, 'Link to a document').onItemClick();
    expect(menus.store.state).toMatchObject({
      show: true,
      triggerCharacter: DOC_LINK_TRIGGER,
      query: '',
    });
    expect(inlineToText(editor.document[0].content)).toBe('see ');

    type('pl');
    expect(menus.store.state).toMatchObject({ query: 'pl' });
    pick();
    insertDocLink(editor, { href: '/app/w1/f/f1/d/d2', title: 'Plan' });
    expect(inlineToText(editor.document[0].content)).toBe('see Plan');
    editor.unmount();
  });

  it('opens the section picker, and a pick inserts a section link', () => {
    const { editor, menus, type, pick } = typingEditor('', MENUS);
    type('/');
    pick();
    titled(editor, 'Link to a section').onItemClick();
    expect(menus.store.state).toMatchObject({
      show: true,
      triggerCharacter: SECTION_LINK_TRIGGER,
    });
    type('go');
    pick();
    insertDocLink(editor, { href: '/app/w1/f/f1/d/d1#b=h1', title: 'Goals' });
    expect(editor.document[0].content).toEqual([
      {
        type: 'link',
        href: '/app/w1/f/f1/d/d1#b=h1',
        content: [{ type: 'text', text: 'Goals', styles: {} }],
      },
    ]);
    editor.unmount();
  });

  it('never opens the section picker from a typed #', () => {
    const { editor, menus, type } = typingEditor('see ', MENUS);
    type('#');
    expect(menus.store.state?.show).toBeFalsy();
    editor.unmount();
  });
});
