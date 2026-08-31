// BlockNote schema with a custom inline `fontSize` style.
//
// This restores the PR1 feature where a user can set a custom font size
// on just the selected text range (independent of the block-level
// heading levels). BlockNote models it as a custom inline *style* — a
// `<span style="font-size: …">` wrapping the styled range — registered
// on the editor schema and applied via `editor.addStyles({ fontSize })`
// (see FontSizeButton in the formatting toolbar).

import React from 'react';
import { BlockNoteSchema, defaultStyleSpecs } from '@blocknote/core';
import { createReactStyleSpec } from '@blocknote/react';

export const fontSizeStyle = createReactStyleSpec(
  { type: 'fontSize', propSchema: 'string' },
  {
    render: (props) => (
      <span ref={props.contentRef} style={{ fontSize: props.value }} />
    ),
  },
);

// The editor schema = all default blocks/inline-content + our extra
// inline style. `defaultStyleSpecs` keeps bold/italic/underline/etc.
export const schema = BlockNoteSchema.create({
  styleSpecs: {
    ...defaultStyleSpecs,
    fontSize: fontSizeStyle,
  },
});

// Editor type bound to our schema — used by the shell + toolbar so
// `editor.addStyles({ fontSize })` type-checks against the custom style.
export type DriveEditor = typeof schema.BlockNoteEditor;

// Preset sizes surfaced in the toolbar control. `null` clears the
// custom size (revert to the block's default).
export const FONT_SIZE_OPTIONS: { label: string; value: string | null }[] = [
  { label: 'Default', value: null },
  { label: 'Small', value: '12px' },
  { label: 'Normal', value: '16px' },
  { label: 'Large', value: '20px' },
  { label: 'Huge', value: '28px' },
];
