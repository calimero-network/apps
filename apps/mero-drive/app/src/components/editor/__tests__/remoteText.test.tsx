// A peer's text change applied to a live, headless BlockNote editor built from
// the app's own schema, so mark names and positions are the real ones.
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCreateBlockNote } from '@blocknote/react';
import { TextSelection } from 'prosemirror-state';
import { schema } from '../blocknote/schema';
import { applyRemoteText, flushPendingInput } from '../remoteText';
import { blockGeometry, type DocNode } from '../presence/geometry';

function editorWith(text: string) {
  const { result } = renderHook(() =>
    useCreateBlockNote({
      schema,
      initialContent: [{ id: 'b1', type: 'paragraph', content: text }],
    }),
  );
  return result.current;
}

const plainText = (editor: ReturnType<typeof editorWith>) =>
  (editor.document[0].content as { text: string }[]).map((c) => c.text).join('');

/** Puts the caret `offset` characters into block b1. */
function caretAt(editor: ReturnType<typeof editorWith>, offset: number) {
  editor.transact((tr) => {
    const geometry = blockGeometry(tr.doc as unknown as DocNode, 'b1');
    if (!geometry) throw new Error('no block b1');
    tr.setSelection(TextSelection.create(tr.doc, geometry.contentStart + offset));
  });
}

function caretOffset(editor: ReturnType<typeof editorWith>): number {
  const state = editor._tiptapEditor.state;
  const geometry = blockGeometry(state.doc as unknown as DocNode, 'b1');
  if (!geometry) throw new Error('no block b1');
  return state.selection.head - geometry.contentStart;
}

describe('applyRemoteText', () => {
  it('inserts and deletes by scalar position inside the existing block', () => {
    const editor = editorWith('The fox.');
    expect(applyRemoteText(editor, 'b1', [{ insert: 'PEER ', attributes: {} }])).toBe(true);
    expect(plainText(editor)).toBe('PEER The fox.');
    expect(applyRemoteText(editor, 'b1', [{ retain: 9 }, { delete: 4 }])).toBe(true);
    expect(plainText(editor)).toBe('PEER The ');
    expect(editor.document.map((b) => b.id)).toEqual(['b1']);
  });

  it('carries a caret at the end of the block past an insert before it', () => {
    const editor = editorWith('The fox.');
    caretAt(editor, 8);
    applyRemoteText(editor, 'b1', [{ insert: 'PEER ', attributes: {} }]);
    expect(caretOffset(editor)).toBe(13);
  });

  it('bolds and unbolds a range as marks on the same text', () => {
    const editor = editorWith('The quick fox.');
    applyRemoteText(editor, 'b1', [{ retain: 4 }, { retain: 5, attributes: { bold: 'true' } }]);
    expect(editor.document[0].content).toEqual([
      { type: 'text', text: 'The ', styles: {} },
      { type: 'text', text: 'quick', styles: { bold: true } },
      { type: 'text', text: ' fox.', styles: {} },
    ]);
    applyRemoteText(editor, 'b1', [{ retain: 4 }, { retain: 5, attributes: { bold: null } }]);
    expect(editor.document[0].content).toEqual([{ type: 'text', text: 'The quick fox.', styles: {} }]);
  });

  it('inserts text carrying exactly the marks the change names', () => {
    const editor = editorWith('ab');
    applyRemoteText(editor, 'b1', [{ retain: 1 }, { insert: 'X', attributes: { italic: 'true' } }]);
    expect(editor.document[0].content).toEqual([
      { type: 'text', text: 'a', styles: {} },
      { type: 'text', text: 'X', styles: { italic: true } },
      { type: 'text', text: 'b', styles: {} },
    ]);
  });

  it('declines a link, which BlockNote holds as an inline node rather than a mark', () => {
    const editor = editorWith('ab');
    expect(applyRemoteText(editor, 'b1', [{ retain: 2, attributes: { link: 'https://x' } }])).toBe(false);
    expect(plainText(editor)).toBe('ab');
  });

  it('reads input the view has not processed before a peer change is applied', () => {
    const flush = vi.fn();
    flushPendingInput({ domObserver: { flush } } as unknown as Parameters<typeof flushPendingInput>[0]);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(() => flushPendingInput(undefined)).not.toThrow();
    const unmounted = new Proxy({}, { get: () => { throw new Error('not mounted'); } });
    expect(() => flushPendingInput(unmounted as Parameters<typeof flushPendingInput>[0])).not.toThrow();
  });
});
