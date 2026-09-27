// Block attributes on a mounted editor. Written straight onto the DOM they
// were redrawn away on ProseMirror's next mutation flush, so every check
// here waits for that flush first.
import { describe, it, expect, afterEach } from 'vitest';
import { BlockNoteEditor, createExtension } from '@blocknote/core';
import { schema } from '../schema';
import { blockDecorations, setSectionWash } from '../blockDecorations';

const mounted: BlockNoteEditor<never, never, never>[] = [];

function mountEditor() {
  const editor = BlockNoteEditor.create({
    schema,
    extensions: [createExtension({ key: 'blockAttrs', prosemirrorPlugins: [blockDecorations()] })],
  });
  const root = document.createElement('div');
  document.body.appendChild(root);
  editor.mount(root);
  editor.replaceBlocks(editor.document, [
    { id: 'blk-1', type: 'heading', content: 'Milestones' },
    { id: 'blk-2', type: 'paragraph', content: 'Ship it' },
  ]);
  mounted.push(editor as never);
  return { editor, root };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));
const stamped = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('[data-testid="doc-block"]')].map((el) => el.dataset.blockId);

afterEach(() => {
  for (const editor of mounted.splice(0)) editor.unmount();
  document.body.innerHTML = '';
});

describe('blockDecorations', () => {
  it('addresses each block by its id, and the address outlives a DOM flush', async () => {
    const { root } = mountEditor();
    await flush();
    expect(stamped(root)).toEqual(['blk-1', 'blk-2']);
  });

  it('addresses a block added later', async () => {
    const { editor, root } = mountEditor();
    editor.insertBlocks([{ id: 'blk-3', type: 'paragraph', content: 'More' }], 'blk-2', 'after');
    await flush();
    expect(stamped(root)).toEqual(['blk-1', 'blk-2', 'blk-3']);
  });

  it('washes one block until told to stop', async () => {
    const { editor, root } = mountEditor();
    const view = editor.prosemirrorView!;
    setSectionWash(view, 'blk-2');
    await flush();
    const washed = () =>
      [...root.querySelectorAll<HTMLElement>('.section-wash')].map((el) => el.dataset.blockId);
    expect(washed()).toEqual(['blk-2']);

    setSectionWash(view, null);
    await flush();
    expect(washed()).toEqual([]);
  });
});
