// A live headless editor, and one that types through BlockNote's text input
// handling so suggestion menus open as they do for a user.
import { vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCreateBlockNote } from '@blocknote/react';
import {
  SuggestionMenu,
  type SuggestionMenuOptions,
} from '@blocknote/core/extensions';
import { schema, type DriveEditor } from '../schema';

export function editorWith(content: string): DriveEditor {
  const { result } = renderHook(() => useCreateBlockNote({ schema }));
  const editor = result.current as DriveEditor;
  editor.replaceBlocks(editor.document, [{ type: 'paragraph', content }]);
  editor.setTextCursorPosition(editor.document[0].id, 'end');
  return editor;
}

export function typingEditor(content: string, menus: SuggestionMenuOptions[]) {
  // The menu measures its anchor, which jsdom leaves unimplemented.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    toJSON: () => ({}),
  } as DOMRect);
  const editor = editorWith(content);
  editor.mount(document.body.appendChild(document.createElement('div')));
  const suggestions = editor.getExtension(SuggestionMenu)!;
  menus.forEach((menu) => suggestions.addSuggestionMenu(menu));
  const view = editor.prosemirrorView!;
  // A focused view scrolls to the caret, which jsdom cannot measure.
  Object.assign(view, { scrollToSelection() {} });
  const type = (chars: string) => {
    for (const ch of chars) {
      const at = view.state.selection.from;
      const handled = view.someProp('handleTextInput', (f) =>
        f(view, at, at, ch, () => view.state.tr),
      );
      if (!handled) view.dispatch(view.state.tr.insertText(ch));
    }
  };
  // What a menu does on a pick before its own handler runs.
  const pick = () => {
    suggestions.closeMenu();
    suggestions.clearQuery();
  };
  return { editor, menus: suggestions, type, pick };
}
