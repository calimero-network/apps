// The translation against a live editor, whose schema checks every prop and
// kind: what the node stores must load, and come back out unchanged.
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCreateBlockNote } from '@blocknote/react';
import { schema } from '@/components/editor/blocknote/schema';
import { diffBlocks, type EditorBlock } from '../blocks';
import { fromBlockNote, toBlockNote } from '../blocknote';

const liveEditor = () =>
  renderHook(() => useCreateBlockNote({ schema })).result.current;

const IMAGE: EditorBlock = {
  id: 'img',
  kind: 'image',
  depth: 0,
  attrs: {
    caption: '1999',
    name: '2024',
    previewWidth: '512',
    showPreview: 'true',
    textAlignment: 'left',
    url: `blob:${'ab'.repeat(32)}`,
  },
  inline: [],
};
const UNKNOWN: EditorBlock = {
  id: 'kb',
  kind: 'kanban',
  depth: 0,
  attrs: { columns: '3', title: 'Plan' },
  inline: [{ text: 'Todo', attributes: { bold: 'true' } }],
};
const CHILD: EditorBlock = {
  id: 'p',
  kind: 'paragraph',
  depth: 1,
  attrs: { textAlignment: 'left' },
  inline: [{ text: 'under it', attributes: {} }],
};

describe('an image block', () => {
  it('keeps a numeric-looking name and caption as text and the width as a number', () => {
    const [node] = toBlockNote([IMAGE]);
    expect(node.props).toMatchObject({
      name: '2024',
      caption: '1999',
      previewWidth: 512,
      showPreview: true,
    });
  });

  it('round-trips through the editor without a write', () => {
    const editor = liveEditor();
    editor.replaceBlocks(editor.document, toBlockNote([IMAGE]) as never);
    const back = fromBlockNote(editor.document).filter((b) => b.id === 'img');
    expect(back).toEqual([IMAGE]);
    expect(diffBlocks([IMAGE], back)).toEqual([]);
  });
});

describe('a block kind this version does not know', () => {
  it('loads into the editor instead of throwing', () => {
    const editor = liveEditor();
    expect(() =>
      editor.replaceBlocks(editor.document, toBlockNote([UNKNOWN, CHILD]) as never),
    ).not.toThrow();
    expect(() =>
      editor.insertBlocks(
        toBlockNote([{ ...UNKNOWN, id: 'kb2' }]) as never,
        editor.document[0].id,
        'after',
      ),
    ).not.toThrow();
  });

  it('comes back out exactly as the node holds it, so nothing is written over it', () => {
    const editor = liveEditor();
    editor.replaceBlocks(editor.document, toBlockNote([UNKNOWN, CHILD]) as never);
    const back = fromBlockNote(editor.document);
    expect(back).toEqual([UNKNOWN, CHILD]);
    expect(diffBlocks([UNKNOWN, CHILD], back)).toEqual([]);
  });

  it('is held back even when a peer names the placeholder kind itself', () => {
    const forged = { ...UNKNOWN, kind: 'unsupported', attrs: { block: '{' } };
    const editor = liveEditor();
    editor.replaceBlocks(editor.document, toBlockNote([forged]) as never);
    expect(fromBlockNote(editor.document)).toEqual([forged]);
  });
});
