// BlockNote nests blocks and types its props; the backend stores a flat list
// with a depth and string attrs. This is the only place that translation
// happens, so the diff and the render can never disagree about the shape.

import { schema, UNSUPPORTED_BLOCK } from '@/components/editor/blocknote/schema';
import { inlineToSpans, spansToInline, type AttrSpan, type IdRun } from './delta';
import type { EditorBlock } from './blocks';
import type { InlineContent } from './delta';

/** One block as BlockNote holds it, narrowed to the fields that round-trip. */
export interface BlockNoteBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown;
  children: BlockNoteBlock[];
}

/** One block as the backend returns it from get_document. */
export interface BackendBlock {
  id: string;
  kind: string;
  depth: number;
  attrs: Record<string, string>;
  spans: { text: string; attributes?: Record<string, string> }[];
  ids?: IdRun[];
}

// BlockNote writes this for a prop the user never set, and the backend should
// not carry a row for it.
const DEFAULT_PROP = 'default';

type BlockSpecs = Record<string, (typeof schema.blockSchema)[keyof typeof schema.blockSchema]>;
const SPECS: BlockSpecs = schema.blockSchema;

/** The block's kind as the editor can hold it; the placeholder itself is never taken at its word. */
const specOf = (kind: string) => (kind === UNSUPPORTED_BLOCK ? undefined : SPECS[kind]);

/** What the placeholder keeps of a block this version cannot show. */
type Kept = Pick<EditorBlock, 'kind' | 'attrs' | 'inline'>;

/** The editor's nested document as the flat list the backend diff takes. */
export function fromBlockNote(document: BlockNoteBlock[]): EditorBlock[] {
  const out: EditorBlock[] = [];
  const walk = (blocks: BlockNoteBlock[], depth: number) => {
    for (const block of blocks) {
      if (block.type === UNSUPPORTED_BLOCK) {
        const kept = JSON.parse(String(block.props.block)) as Kept;
        out.push({ id: block.id, depth, ...kept });
      } else {
        out.push({
          id: block.id,
          kind: block.type,
          depth,
          attrs: propsToAttrs(block.props),
          inline: inlineToSpans(inlineOf(block)),
        });
      }
      walk(block.children ?? [], depth + 1);
    }
  };
  walk(document, 0);
  return out;
}

/** The flat list as the editor's nested document. */
export function toBlockNote(blocks: EditorBlock[]): BlockNoteBlock[] {
  const document: BlockNoteBlock[] = [];
  // A block nests under the nearest preceding one that is shallower, so a
  // depth the editor cannot represent still lands somewhere sensible.
  const open: BlockNoteBlock[] = [];
  for (const block of blocks) {
    const node = blockNoteNode(block);
    open.length = Math.min(block.depth, open.length);
    const parent = open[open.length - 1];
    if (parent) parent.children.push(node);
    else document.push(node);
    open.push(node);
  }
  return document;
}

const sameBlock = (a: BlockNoteBlock, b: BlockNoteBlock): boolean =>
  JSON.stringify(fromBlockNote([a])) === JSON.stringify(fromBlockNote([b]));

/** The top-level blocks `target` changes, with the unchanged ones at both ends
 *  trimmed off, so a replace leaves those blocks and their undo history alone.
 *  `same` decides which blocks are unchanged. */
export function changedRange(
  current: BlockNoteBlock[],
  target: BlockNoteBlock[],
  same: (a: BlockNoteBlock, b: BlockNoteBlock) => boolean = sameBlock,
): { at: number; remove: BlockNoteBlock[]; insert: BlockNoteBlock[] } {
  let head = 0;
  while (head < current.length && head < target.length && same(current[head], target[head])) head += 1;
  let tail = 0;
  while (
    tail < current.length - head &&
    tail < target.length - head &&
    same(current[current.length - 1 - tail], target[target.length - 1 - tail])
  ) {
    tail += 1;
  }
  return {
    at: head,
    remove: current.slice(head, current.length - tail),
    insert: target.slice(head, target.length - tail),
  };
}

/** The backend's get_document rows as editor blocks. */
export function backendBlocks(rows: BackendBlock[]): EditorBlock[] {
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    depth: row.depth,
    attrs: { ...row.attrs },
    inline: backendSpans(row.spans),
    ...(row.ids ? { ids: row.ids } : {}),
  }));
}

/** The spans of one backend block, for a single-block re-read. */
export function backendSpans(
  spans: BackendBlock['spans'] | undefined,
): AttrSpan[] {
  return (spans ?? []).map((span) => ({
    text: span.text,
    attributes: { ...(span.attributes ?? {}) },
  }));
}

function inlineOf(block: BlockNoteBlock): InlineContent[] {
  return Array.isArray(block.content) ? (block.content as InlineContent[]) : [];
}

function propsToAttrs(props: Record<string, unknown>): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const key of Object.keys(props ?? {}).sort()) {
    const value = props[key];
    if (value === null || value === undefined || value === DEFAULT_PROP) {
      continue;
    }
    const text = String(value);
    if (text !== '') attrs[key] = text;
  }
  return attrs;
}

/** One flat block as a childless editor node; a kind the schema lacks becomes the placeholder. */
function blockNoteNode(block: EditorBlock): BlockNoteBlock {
  const spec = specOf(block.kind);
  if (!spec) {
    const kept: Kept = { kind: block.kind, attrs: block.attrs, inline: block.inline };
    return {
      id: block.id,
      type: UNSUPPORTED_BLOCK,
      props: { block: JSON.stringify(kept) },
      children: [],
    };
  }
  return {
    id: block.id,
    type: block.kind,
    props: attrsToProps(spec.propSchema, block.attrs),
    content: spec.content === 'none' ? undefined : spansToInline(block.inline),
    children: [],
  };
}

/** Attrs as typed props, by the prop's declared type: a caption of "2024" stays text. */
function attrsToProps(
  propSchema: Record<string, { default?: unknown; type?: string }>,
  attrs: Record<string, string>,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const prop = propSchema[key];
    const type = prop?.type ?? typeof prop?.default;
    if (type === 'boolean') props[key] = value === 'true';
    else if (type === 'number') props[key] = Number(value);
    else props[key] = value;
  }
  return props;
}
