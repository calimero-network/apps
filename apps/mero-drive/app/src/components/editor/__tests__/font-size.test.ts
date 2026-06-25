// Verifies the FontSize/TextStyle wiring the toolbar relies on: that
// editor.chain().setFontSize(...) actually emits an inline font-size on
// the selection and unsetFontSize() clears it. Mirrors the extensions
// registered in EditorShell so a regression in that list is caught here.

import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';

describe('FontSize extension wiring', () => {
  it('applies a custom font size to the selected range and clears it', () => {
    const editor = new Editor({
      extensions: [StarterKit, TextStyle, FontSize],
      content: '<p>hello world</p>',
    });

    editor.chain().selectAll().setFontSize('20px').run();
    expect(editor.getHTML()).toContain('font-size: 20px');

    editor.chain().selectAll().unsetFontSize().run();
    expect(editor.getHTML()).not.toContain('font-size');

    editor.destroy();
  });

  it('sizes ONLY the selected range, not the whole document', () => {
    const editor = new Editor({
      extensions: [StarterKit, TextStyle, FontSize],
      content: '<p>hello world</p>',
    });

    // Select just "hello" (PM positions: text starts at 1; "hello" = 1..6).
    editor.chain().setTextSelection({ from: 1, to: 6 }).setFontSize('20px').run();
    const html = editor.getHTML();

    // "hello" wrapped in a single sized span; " world" sits OUTSIDE it.
    expect(html).toContain('font-size: 20px');
    expect((html.match(/font-size/g) || []).length).toBe(1);
    expect(html).toContain('</span> world');

    editor.destroy();
  });
});
