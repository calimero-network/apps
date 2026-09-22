// The editor schema is deliberately a SUBSET of BlockNote's defaults: every
// block kind, mark and inline node here round-trips through the document CRDT,
// and anything the backend's mark schema rejects is not offered in the UI.

import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core';

const { paragraph, heading, bulletListItem } = defaultBlockSpecs;
const { bold, italic } = defaultStyleSpecs;
const { text, link } = defaultInlineContentSpecs;

export const schema = BlockNoteSchema.create({
  blockSpecs: { paragraph, heading, bulletListItem },
  styleSpecs: { bold, italic },
  inlineContentSpecs: { text, link },
});

/** Editor type bound to this schema, so the shell and toolbar type-check. */
export type DriveEditor = typeof schema.BlockNoteEditor;
