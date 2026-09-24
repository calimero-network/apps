// BlockNote nests blocks and types its props; the backend stores a flat list
// with a depth and string attrs. This is the only place that translation
// happens, so the diff and the render can never disagree about the shape.

import { inlineToSpans, spansToInline, type AttrSpan } from './delta';
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
}

// BlockNote writes this for a prop the user never set, and the backend should
// not carry a row for it.
const DEFAULT_PROP = 'default';

/** The editor's nested document as the flat list the backend diff takes. */
export function fromBlockNote(document: BlockNoteBlock[]): EditorBlock[] {
  const out: EditorBlock[] = [];
  const walk = (blocks: BlockNoteBlock[], depth: number) => {
    for (const block of blocks) {
      out.push({
        id: block.id,
        kind: block.type,
        depth,
        attrs: propsToAttrs(block.props),
        inline: inlineToSpans(inlineOf(block)),
      });
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
    const node: BlockNoteBlock = {
      id: block.id,
      type: block.kind,
      props: attrsToProps(block.attrs),
      content: spansToInline(block.inline),
      children: [],
    };
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
 *  trimmed off, so a replace leaves those blocks and their undo history alone. */
export function changedRange(
  current: BlockNoteBlock[],
  target: BlockNoteBlock[],
): { at: number; remove: BlockNoteBlock[]; insert: BlockNoteBlock[] } {
  let head = 0;
  while (head < current.length && head < target.length && sameBlock(current[head], target[head])) head += 1;
  let tail = 0;
  while (
    tail < current.length - head &&
    tail < target.length - head &&
    sameBlock(current[current.length - 1 - tail], target[target.length - 1 - tail])
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

function attrsToProps(attrs: Record<string, string>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === 'true' || value === 'false') props[key] = value === 'true';
    else if (/^-?\d+$/.test(value)) props[key] = Number(value);
    else props[key] = value;
  }
  return props;
}
