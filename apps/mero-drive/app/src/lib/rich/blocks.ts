// Two editor block lists in, the ordered backend calls that reconcile them out.
// A block the editor just created has no backend id, so calls naming it carry a
// placeholder the caller swaps for the id insert_block or split_block returned.

import { diffSpans, type AttrSpan, type Change } from './delta';

/** One block as the editor holds it; `id` is the editor's own, not the backend's. */
export interface EditorBlock {
  id: string;
  kind: string;
  depth: number;
  attrs: Record<string, string>;
  inline: AttrSpan[];
}

export type BlockCall =
  | { call: 'merge_blocks'; first: string; second: string }
  | { call: 'split_block'; block: string; at: number; ref: string }
  | { call: 'delete_block'; block: string }
  | {
      call: 'insert_block';
      after: string | null;
      kind: string;
      depth: number;
      ref: string;
    }
  | { call: 'move_block'; block: string; after: string | null }
  | { call: 'set_kind'; block: string; kind: string }
  | { call: 'set_depth'; block: string; depth: number }
  | { call: 'set_attr'; block: string; key: string; value: string | null }
  | { call: 'apply_delta'; block: string; ops: Change[] };

const PLACEHOLDER_PREFIX = 'new:';

/** The stand-in for a block the backend has not minted an id for yet. */
export function placeholderFor(editorId: string): string {
  return `${PLACEHOLDER_PREFIX}${editorId}`;
}

export function isPlaceholder(id: string): boolean {
  return id.startsWith(PLACEHOLDER_PREFIX);
}

/** The backend's state of one block as this diff believes it to be. */
interface Working {
  editorId: string;
  ref: string;
  kind: string;
  depth: number;
  attrs: Record<string, string>;
  inline: AttrSpan[];
}

const textOf = (inline: AttrSpan[]): string =>
  inline.map((span) => span.text).join('');

function splitInline(inline: AttrSpan[], at: number): [AttrSpan[], AttrSpan[]] {
  const head: AttrSpan[] = [];
  const tail: AttrSpan[] = [];
  let seen = 0;
  for (const span of inline) {
    const chars = Array.from(span.text);
    const take = Math.min(Math.max(at - seen, 0), chars.length);
    if (take > 0) {
      head.push({
        text: chars.slice(0, take).join(''),
        attributes: span.attributes,
      });
    }
    if (take < chars.length) {
      tail.push({
        text: chars.slice(take).join(''),
        attributes: span.attributes,
      });
    }
    seen += chars.length;
  }
  return [head, tail];
}

/** The ordered backend calls turning `prev` into `next`. */
export function diffBlocks(
  prev: EditorBlock[],
  next: EditorBlock[],
): BlockCall[] {
  const calls: BlockCall[] = [];
  const prevIds = new Set(prev.map((b) => b.id));
  const nextIds = new Set(next.map((b) => b.id));
  const work: Working[] = prev.map((b) => ({
    editorId: b.id,
    ref: b.id,
    kind: b.kind,
    depth: b.depth,
    attrs: { ...b.attrs },
    inline: b.inline,
  }));
  const indexOf = (editorId: string) =>
    work.findIndex((w) => w.editorId === editorId);

  // Backspace at a block start: a surviving block absorbs the whole text of the
  // block that followed it, and that block is gone.
  for (const nb of next) {
    const at = indexOf(nb.id);
    const after = work[at + 1];
    if (at < 0 || !after || nextIds.has(after.editorId)) continue;
    if (textOf(work[at].inline) + textOf(after.inline) !== textOf(nb.inline)) {
      continue;
    }
    calls.push({
      call: 'merge_blocks',
      first: work[at].ref,
      second: after.ref,
    });
    work[at].inline = [...work[at].inline, ...after.inline];
    work.splice(at + 1, 1);
  }

  // Enter inside a block: a new block appears right after one that lost exactly
  // the tail the new one carries. split_block hands it the original's shape.
  for (let i = 1; i < next.length; i++) {
    if (prevIds.has(next[i].id) || !prevIds.has(next[i - 1].id)) continue;
    const at = indexOf(next[i - 1].id);
    if (at < 0) continue;
    const headText = textOf(next[i - 1].inline);
    if (textOf(work[at].inline) !== headText + textOf(next[i].inline)) continue;
    const position = Array.from(headText).length;
    const [head, tail] = splitInline(work[at].inline, position);
    const ref = placeholderFor(next[i].id);
    calls.push({ call: 'split_block', block: work[at].ref, at: position, ref });
    work[at].inline = head;
    work.splice(at + 1, 0, {
      editorId: next[i].id,
      ref,
      kind: work[at].kind,
      depth: work[at].depth,
      attrs: { ...work[at].attrs },
      inline: tail,
    });
  }

  for (let i = work.length - 1; i >= 0; i--) {
    if (nextIds.has(work[i].editorId)) continue;
    calls.push({ call: 'delete_block', block: work[i].ref });
    work.splice(i, 1);
  }

  for (let cursor = 0; cursor < next.length; cursor++) {
    const nb = next[cursor];
    const after = cursor === 0 ? null : work[cursor - 1].ref;
    let at = indexOf(nb.id);
    if (at < 0) {
      const ref = placeholderFor(nb.id);
      calls.push({
        call: 'insert_block',
        after,
        kind: nb.kind,
        depth: nb.depth,
        ref,
      });
      work.splice(cursor, 0, {
        editorId: nb.id,
        ref,
        kind: nb.kind,
        depth: nb.depth,
        attrs: {},
        inline: [],
      });
    } else if (at !== cursor) {
      calls.push({ call: 'move_block', block: work[at].ref, after });
      work.splice(cursor, 0, ...work.splice(at, 1));
    }
    at = cursor;
    const current = work[at];
    if (current.kind !== nb.kind) {
      calls.push({ call: 'set_kind', block: current.ref, kind: nb.kind });
    }
    if (current.depth !== nb.depth) {
      calls.push({ call: 'set_depth', block: current.ref, depth: nb.depth });
    }
    for (const key of [
      ...new Set([...Object.keys(current.attrs), ...Object.keys(nb.attrs)]),
    ].sort()) {
      if (current.attrs[key] === nb.attrs[key]) continue;
      calls.push({
        call: 'set_attr',
        block: current.ref,
        key,
        value: nb.attrs[key] ?? null,
      });
    }
    const ops = diffSpans(current.inline, nb.inline);
    if (ops.length > 0) {
      calls.push({ call: 'apply_delta', block: current.ref, ops });
    }
  }
  return calls;
}
