// A peer's text change applied to a live, headless BlockNote editor built from
// the app's own schema, so mark names and positions are the real ones.
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCreateBlockNote } from '@blocknote/react';
import { TextSelection } from 'prosemirror-state';
import { schema } from '../blocknote/schema';
import { applyRemoteText, domSelection, flushPendingInput, keepSelection, syncSelectionFromDom } from '../remoteText';
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

  it('keeps a selection the view has not recorded, carried through the peer steps', () => {
    const editor = editorWith('The fox.');
    editor.transact((tr) => {
      const geometry = blockGeometry(tr.doc as unknown as DocNode, 'b1');
      if (!geometry) throw new Error('no block b1');
      const fox = { anchor: geometry.contentStart + 4, head: geometry.contentStart + 7 };
      tr.insertText('PEER ', geometry.contentStart);
      keepSelection(tr, fox);
    });
    const state = editor._tiptapEditor.state;
    const start = blockGeometry(state.doc as unknown as DocNode, 'b1')?.contentStart ?? 0;
    expect([state.selection.anchor - start, state.selection.head - start]).toEqual([9, 12]);
  });

  it('reports no browser selection without a view to read it from', () => {
    expect(domSelection(undefined)).toBeNull();
  });

  it('records the browser selection before a key acts on a stale one', () => {
    const editor = editorWith('The fox.');
    const state = () => editor._tiptapEditor.state;
    const start = blockGeometry(state().doc as unknown as DocNode, 'b1')?.contentStart ?? 0;
    const dispatch = vi.fn();
    const inside = document.createElement('p');
    const view = {
      state: state(),
      dom: { contains: () => true },
      root: { getSelection: () => ({ anchorNode: inside, anchorOffset: 4, focusNode: inside, focusOffset: 7 }) },
      posAtDOM: (_node: Node, offset: number) => start + offset,
      dispatch,
    } as unknown as Parameters<typeof syncSelectionFromDom>[0];
    syncSelectionFromDom(view);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const selection = dispatch.mock.calls[0][0].selection;
    expect([selection.anchor - start, selection.head - start]).toEqual([4, 7]);
  });

  it('dispatches nothing when the view already records the browser selection', () => {
    const editor = editorWith('The fox.');
    const state = editor._tiptapEditor.state;
    const dispatch = vi.fn();
    const view = {
      state,
      dom: { contains: () => true },
      root: { getSelection: () => ({ anchorNode: {}, anchorOffset: 0, focusNode: {}, focusOffset: 0 }) },
      posAtDOM: () => state.selection.anchor,
      dispatch,
    } as unknown as Parameters<typeof syncSelectionFromDom>[0];
    syncSelectionFromDom(view);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps a caret before a peer insert landing exactly on it, so its own run stays whole', () => {
    const editor = editorWith('ab');
    editor.transact((tr) => {
      const geometry = blockGeometry(tr.doc as unknown as DocNode, 'b1');
      if (!geometry) throw new Error('no block b1');
      const caret = geometry.contentStart + 2;
      tr.insertText('PEER', caret);
      keepSelection(tr, { anchor: caret, head: caret });
    });
    const state = editor._tiptapEditor.state;
    const start = blockGeometry(state.doc as unknown as DocNode, 'b1')?.contentStart ?? 0;
    expect(state.selection.head - start).toBe(2);
  });
});
