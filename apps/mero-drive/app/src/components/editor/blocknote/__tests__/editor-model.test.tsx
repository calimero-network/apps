// Headless tests against a live BlockNote editor model (created via
// useCreateBlockNote, but WITHOUT mounting <BlockNoteView> — so no
// Mantine/DOM polyfills are needed). These pin the three facts the
// EditorShell integration depends on:
//
//   1. `replaceBlocks` fires `onChange` — there is no suppress flag, which
//      is precisely why the shell needs the `applyingRemoteRef` guard.
//   2. `serializeBlocks(editor.document)` round-trips through
//      `parseStoredContent` → `replaceBlocks` unchanged (the storage
//      contract DocumentEditor persists).
//   3. The custom `fontSize` inline style is registered on the schema and
//      survives serialization (the PR1 feature, re-implemented).

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCreateBlockNote } from '@blocknote/react';
import { schema } from '../schema';
import { serializeBlocks, parseStoredContent } from '../content';

describe('BlockNote editor model (headless)', () => {
  it('replaceBlocks fires onChange — the reason the remote-apply guard exists', () => {
    const { result } = renderHook(() => useCreateBlockNote({ schema }));
    const editor = result.current;

    const onChange = vi.fn();
    const unsub = editor.onChange(onChange);

    editor.replaceBlocks(editor.document, [
      { type: 'paragraph', content: 'remote text' },
    ]);

    // A programmatic replace is classified identically to a keystroke,
    // so it DOES call onChange. The shell must guard against this.
    expect(onChange).toHaveBeenCalled();
    unsub?.();
  });

  it('document serialization round-trips through parse → replaceBlocks', () => {
    const { result } = renderHook(() => useCreateBlockNote({ schema }));
    const editor = result.current;

    editor.replaceBlocks(editor.document, [
      { type: 'heading', content: 'Title' },
      { type: 'paragraph', content: 'body' },
    ]);
    const serialized = serializeBlocks(editor.document);

    const parsed = parseStoredContent(serialized);
    expect(parsed).toBeTruthy();

    editor.replaceBlocks(editor.document, parsed!);
    expect(serializeBlocks(editor.document)).toBe(serialized);
  });

  it('schema registers the custom fontSize inline style', () => {
    expect(schema.styleSchema.fontSize).toBeDefined();
    expect(schema.styleSchema.fontSize.propSchema).toBe('string');
  });

  it('a fontSize-styled inline node persists through serialization', () => {
    const { result } = renderHook(() => useCreateBlockNote({ schema }));
    const editor = result.current;

    editor.replaceBlocks(editor.document, [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'big', styles: { fontSize: '28px' } }],
      },
    ]);

    const serialized = serializeBlocks(editor.document);
    expect(serialized).toContain('fontSize');
    expect(serialized).toContain('28px');
  });
});
