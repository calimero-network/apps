// Remote carets as ProseMirror decorations. The set is pushed in from outside
// on every presence change and mapped through local edits in between, so a
// peer's caret holds its place while this user keeps typing.

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { CaretDecoration } from '@/lib/rich/cursors';

const PRESENCE_META = 'calimero-presence';

export const presenceKey = new PluginKey<DecorationSet>(PRESENCE_META);

/** Render one peer's caret: a zero-width marker carrying their name. */
function caretElement(spec: CaretDecoration & { kind: 'caret' }): HTMLElement {
  const caret = document.createElement('span');
  caret.className = 'cal-presence-cursor';
  caret.dataset.testid = 'presence-cursor';
  caret.dataset.author = spec.author;
  caret.style.borderLeft = `2px solid ${spec.colour}`;
  const label = document.createElement('span');
  label.className = 'cal-presence-label';
  label.textContent = spec.name;
  label.style.backgroundColor = spec.colour;
  caret.appendChild(label);
  return caret;
}

function build(specs: CaretDecoration[], doc: EditorState['doc']): DecorationSet {
  const size = doc.content.size;
  const decorations: Decoration[] = [];
  for (const spec of specs) {
    if (spec.kind === 'selection') {
      if (spec.from >= size || spec.from >= spec.to) continue;
      decorations.push(
        Decoration.inline(spec.from, Math.min(spec.to, size), {
          class: 'cal-presence-selection',
          style: `background-color: ${spec.colour}33`,
          'data-testid': 'presence-selection',
          'data-author': spec.author,
        }),
      );
      continue;
    }
    if (spec.pos > size) continue;
    decorations.push(
      Decoration.widget(spec.pos, () => caretElement(spec), {
        side: 1,
        key: `presence-${spec.author}`,
      }),
    );
  }
  return DecorationSet.create(doc, decorations);
}

/** The plugin the editor mounts; empty until a presence change pushes a set. */
export function presencePlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: presenceKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, current) {
        const specs = tr.getMeta(presenceKey) as CaretDecoration[] | undefined;
        if (specs) return build(specs, tr.doc);
        return current.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations: (state) => presenceKey.getState(state) ?? DecorationSet.empty,
    },
  });
}

/** Replace the drawn carets with `specs`. */
export function setPresenceDecorations(
  view: EditorView,
  specs: CaretDecoration[],
): void {
  view.dispatch(view.state.tr.setMeta(presenceKey, specs));
}
