// The editor schema is deliberately a SUBSET of BlockNote's defaults: every
// block kind, mark and inline node here round-trips through the document CRDT,
// and anything the backend's mark schema rejects is not offered in the UI.

import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core';
import { createReactBlockSpec } from '@blocknote/react';
import { imageBlock } from './imageBlock';

/** Stands in for a block kind from a newer version; `block` holds it verbatim. */
export const UNSUPPORTED_BLOCK = 'unsupported';

const { paragraph, heading, bulletListItem } = defaultBlockSpecs;
const { bold, italic } = defaultStyleSpecs;
const { text, link } = defaultInlineContentSpecs;

const unsupported = createReactBlockSpec(
  {
    type: UNSUPPORTED_BLOCK,
    propSchema: { block: { default: '' } },
    content: 'none',
  },
  {
    render: () => (
      <div
        contentEditable={false}
        className="w-full rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
      >
        This block needs a newer version of Mero Docs.
      </div>
    ),
  },
)();

export const schema = BlockNoteSchema.create({
  blockSpecs: { paragraph, heading, bulletListItem, image: imageBlock, unsupported },
  styleSpecs: { bold, italic },
  inlineContentSpecs: { text, link },
});

/** Editor type bound to this schema, so the shell and toolbar type-check. */
export type DriveEditor = typeof schema.BlockNoteEditor;
