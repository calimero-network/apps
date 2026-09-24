// The Quill-style change list one block's inline content edit becomes. Every
// count is a Unicode scalar, because that is what the backend indexes; an
// insert always carries its complete attribute set, because omitting the set
// makes the inserted text inherit the formatting at its left edge.

import {
  attrDelta,
  attrsEqual,
  attrsToStyles,
  canonicalAttrs,
  stylesToAttrs,
  type AttrDelta,
  type BlockNoteStyles,
  type MarkAttrs,
} from './attributes';

/** One run of equally attributed text, as the backend renders and takes it. */
export interface AttrSpan {
  text: string;
  attributes: MarkAttrs;
}

/** One step of an attributed change, walking the block as it was before. */
export type Change =
  | { retain: number; attributes?: AttrDelta }
  | { insert: string; attributes?: AttrDelta }
  | { delete: number };

/** BlockNote's inline content nodes. */
export interface StyledText {
  type: 'text';
  text: string;
  styles: BlockNoteStyles;
}
export interface LinkContent {
  type: 'link';
  href: string;
  content: StyledText[];
}
export type InlineContent = StyledText | LinkContent;

interface AttrChar {
  ch: string;
  attrs: MarkAttrs;
}

function toChars(spans: AttrSpan[]): AttrChar[] {
  const out: AttrChar[] = [];
  for (const span of spans) {
    const attrs = canonicalAttrs(span.attributes);
    for (const ch of span.text) out.push({ ch, attrs });
  }
  return out;
}

function isRetain(
  op: Change,
): op is { retain: number; attributes?: AttrDelta } {
  return 'retain' in op;
}

/** The minimal change list turning `prev` into `next`. */
export function diffSpans(prev: AttrSpan[], next: AttrSpan[]): Change[] {
  const before = toChars(prev);
  const after = toChars(next);

  let head = 0;
  while (
    head < before.length &&
    head < after.length &&
    before[head].ch === after[head].ch
  ) {
    head += 1;
  }
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail].ch === after[after.length - 1 - tail].ch
  ) {
    tail += 1;
  }

  const ops: Change[] = [];
  let openKey: string | null = null; // serialized delta of the retain ops end on
  const pushRetain = (count: number, delta: AttrDelta) => {
    const key = JSON.stringify(delta);
    const last = ops[ops.length - 1];
    if (last && isRetain(last) && openKey === key) {
      last.retain += count;
      return;
    }
    openKey = key;
    ops.push(
      Object.keys(delta).length > 0
        ? { retain: count, attributes: delta }
        : { retain: count },
    );
  };
  // Unchanged characters share their span's attribute object, so one delta
  // covers a whole run of them.
  const pushRetainRange = (from: number, to: number, shift: number) => {
    let i = from;
    while (i < to) {
      const a = before[i].attrs;
      const b = after[i - shift].attrs;
      let end = i + 1;
      while (
        end < to &&
        before[end].attrs === a &&
        after[end - shift].attrs === b
      ) {
        end += 1;
      }
      pushRetain(end - i, attrDelta(a, b));
      i = end;
    }
  };

  pushRetainRange(0, head, 0);

  const removed = before.length - tail - head;
  if (removed > 0) ops.push({ delete: removed });

  let run = head;
  while (run < after.length - tail) {
    let end = run + 1;
    while (
      end < after.length - tail &&
      attrsEqual(after[end].attrs, after[run].attrs)
    ) {
      end += 1;
    }
    ops.push({
      insert: after
        .slice(run, end)
        .map((c) => c.ch)
        .join(''),
      attributes: { ...after[run].attrs },
    });
    run = end;
  }

  pushRetainRange(
    before.length - tail,
    before.length,
    before.length - after.length,
  );

  // A trailing plain retain names no change past the last one.
  while (ops.length > 0) {
    const last = ops[ops.length - 1];
    if (!isRetain(last) || last.attributes) break;
    ops.pop();
  }
  return ops;
}

/** The change list for plain text, which the title API takes without attributes. */
export function diffText(prev: string, next: string): Change[] {
  return diffSpans(
    [{ text: prev, attributes: {} }],
    [{ text: next, attributes: {} }],
  ).map((op) => ('insert' in op ? { insert: op.insert } : op));
}

/** Backend spans as BlockNote inline content, links nested. */
export function spansToInline(spans: AttrSpan[]): InlineContent[] {
  const out: InlineContent[] = [];
  for (const span of spans) {
    if (!span.text) continue;
    const { styles, href } = attrsToStyles(span.attributes);
    const node: StyledText = { type: 'text', text: span.text, styles };
    const last = out[out.length - 1];
    if (href) {
      if (last && last.type === 'link' && last.href === href) {
        appendText(last.content, node);
      } else {
        out.push({ type: 'link', href, content: [node] });
      }
    } else if (last && last.type === 'text' && sameStyles(last, node)) {
      last.text += node.text;
    } else {
      out.push(node);
    }
  }
  return out;
}

function sameStyles(a: StyledText, b: StyledText): boolean {
  return JSON.stringify(a.styles) === JSON.stringify(b.styles);
}

function appendText(nodes: StyledText[], node: StyledText): void {
  const last = nodes[nodes.length - 1];
  if (last && sameStyles(last, node)) last.text += node.text;
  else nodes.push(node);
}

/** BlockNote inline content as backend spans, a link href on every child. */
export function inlineToSpans(content: InlineContent[]): AttrSpan[] {
  const out: AttrSpan[] = [];
  const push = (text: string, styles: BlockNoteStyles, href: string | null) => {
    if (text) out.push({ text, attributes: stylesToAttrs(styles, href) });
  };
  for (const node of content) {
    if (node.type === 'link') {
      for (const child of node.content)
        push(child.text, child.styles, node.href);
    } else {
      push(node.text, node.styles, null);
    }
  }
  return out;
}
