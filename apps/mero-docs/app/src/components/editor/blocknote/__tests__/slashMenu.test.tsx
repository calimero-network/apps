import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import { inlineToText } from '../content';
import { DOC_LINK_TRIGGER, insertDocLink, opensDocPicker } from '../docLinks';
import {
  blockTypeSelectItems,
  SECTION_LINK_TRIGGER,
  SLASH_TRIGGER,
  slashMenuItems,
} from '../slashMenu';
import { editorWith, typingEditor } from './editorTyping';

afterEach(() => vi.restoreAllMocks());

const MENUS = [
  { triggerCharacter: SLASH_TRIGGER },
  { triggerCharacter: DOC_LINK_TRIGGER, shouldOpen: opensDocPicker },
  { triggerCharacter: SECTION_LINK_TRIGGER, shouldOpen: () => false },
];

const titled = (editor: ReturnType<typeof editorWith>, title: string) =>
  slashMenuItems(editor).find((item) => item.title === title)!;

describe('slashMenuItems', () => {
  it('offers only the blocks the app supports, titled in sentence case', () => {
    const items = slashMenuItems(editorWith(''));
    expect(items.map((item) => [item.group, item.title])).toEqual([
      ['Headings', 'Heading 1'],
      ['Headings', 'Heading 2'],
      ['Headings', 'Heading 3'],
      ['Links', 'Link to a document'],
      ['Links', 'Link to a section'],
      ['Basic blocks', 'Bullet list'],
      ['Basic blocks', 'Paragraph'],
    ]);
  });

  it('offers an image only to someone who may add one', () => {
    const editor = editorWith('');
    expect(slashMenuItems(editor).map((item) => item.key)).not.toContain('image');

    const pickImage = vi.fn();
    const image = slashMenuItems(editor, pickImage).find((item) => item.key === 'image');
    expect(image).toMatchObject({ group: 'Media', title: 'Image' });
    image!.onItemClick();
    expect(pickImage).toHaveBeenCalledOnce();
    expect(
      filterSuggestionItems(slashMenuItems(editor, pickImage), 'photo').map((i) => i.title),
    ).toEqual(['Image']);
  });

  it('names shortcuts by modifier, not by platform', () => {
    const editor = editorWith('');
    expect(titled(editor, 'Heading 1').shortcut).toBe('Mod-Alt-1');
    expect(titled(editor, 'Bullet list').shortcut).toBe('Mod-Shift-8');
  });

  it('finds the links by their aliases', () => {
    const items = slashMenuItems(editorWith(''));
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

describe('blockTypeSelectItems', () => {
  it('offers the same blocks as the / menu in the toolbar, in sentence case', () => {
    const editor = editorWith('');
    expect(
      blockTypeSelectItems(editor.dictionary).map((item) => [
        item.name,
        item.type,
        item.props,
      ]),
    ).toEqual([
      ['Paragraph', 'paragraph', undefined],
      ['Heading 1', 'heading', { level: 1, isToggleable: false }],
      ['Heading 2', 'heading', { level: 2, isToggleable: false }],
      ['Heading 3', 'heading', { level: 3, isToggleable: false }],
      ['Bullet list', 'bulletListItem', undefined],
    ]);
  });

  it('picks blocks by type and level, not by their translated names', () => {
    const { dictionary } = editorWith('');
    const sameNames = {
      ...dictionary,
      slash_menu: {
        ...dictionary.slash_menu,
        heading_4: dictionary.slash_menu.heading,
      },
    };
    expect(
      blockTypeSelectItems(sameNames).map((item) => item.props?.level),
    ).toEqual([undefined, 1, 2, 3, undefined]);
  });
});
