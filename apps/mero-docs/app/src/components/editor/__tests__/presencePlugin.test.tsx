// Peer carets drawn by a real ProseMirror view over the app's own schema.
import { describe, it, expect } from 'vitest';
import { renderHook, within } from '@testing-library/react';
import { useCreateBlockNote } from '@blocknote/react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../blocknote/schema';
import { presencePlugin, setPresenceDecorations } from '../presence/presencePlugin';
import { blockGeometry, type DocNode } from '../presence/geometry';

function viewOf(text: string) {
  const { result } = renderHook(() =>
    useCreateBlockNote({ schema, initialContent: [{ id: 'b1', type: 'paragraph', content: text }] }),
  );
  const doc = result.current._tiptapEditor.state.doc;
  const view = new EditorView(document.createElement('div'), {
    state: EditorState.create({ doc, plugins: [presencePlugin()] }),
  });
  const start = blockGeometry(doc as unknown as DocNode, 'b1')?.contentStart ?? 0;
  return { view, start };
}

const bobAt = (pos: number) => [{ kind: 'caret' as const, author: 'bob', name: 'Bob', colour: '#f97316', pos }];
const caretNode = (view: EditorView) => within(view.dom as HTMLElement).queryByTestId('presence-cursor');

describe('presence carets', () => {
  it("rebuilds a peer's caret when they move, so its name flag shows again, and keeps it while they stay", () => {
    const { view, start } = viewOf('The fox.');
    setPresenceDecorations(view, bobAt(start + 1));
    const first = caretNode(view);
    expect(first?.dataset.name).toBe('Bob');
    expect(first?.textContent).toBe('');

    setPresenceDecorations(view, bobAt(start + 1));
    expect(caretNode(view)).toBe(first);

    setPresenceDecorations(view, bobAt(start + 4));
    const moved = caretNode(view);
    expect(moved).not.toBe(first);
    expect(moved?.dataset.name).toBe('Bob');
  });
});
