// Attributes on each block's element, held as ProseMirror decorations: set on
// the DOM directly, the next mutation flush redraws the block and drops them.

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

const BLOCK_NODE = 'blockContainer'; // BlockNote's node for one block; its id attr is the block id
const WASH_CLASS = 'section-wash'; // animation in index.css

interface BlockAttrs {
  wash: string | null;
  decorations: DecorationSet;
}

const blockAttrsKey = new PluginKey<BlockAttrs>('calimero-block-attrs');

// The browser suites address blocks through the testid and the id.
function build(doc: EditorState['doc'], wash: string | null): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== BLOCK_NODE) return true;
    const id = String(node.attrs.id);
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        'data-testid': 'doc-block',
        'data-block-id': id,
        ...(id === wash ? { class: WASH_CLASS } : {}),
      }),
    );
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

export function blockDecorations(): Plugin<BlockAttrs> {
  return new Plugin<BlockAttrs>({
    key: blockAttrsKey,
    state: {
      init: (_config, state) => ({ wash: null, decorations: build(state.doc, null) }),
      apply(tr, current, _old, state) {
        const meta = tr.getMeta(blockAttrsKey) as string | null | undefined;
        const wash = meta === undefined ? current.wash : meta;
        if (!tr.docChanged && wash === current.wash) return current;
        return { wash, decorations: build(state.doc, wash) };
      },
    },
    props: {
      decorations: (state) => blockAttrsKey.getState(state)?.decorations,
    },
  });
}

/** Washes one block (the section a link opened), or none. */
export function setSectionWash(view: EditorView, blockId: string | null): void {
  view.dispatch(view.state.tr.setMeta(blockAttrsKey, blockId));
}
