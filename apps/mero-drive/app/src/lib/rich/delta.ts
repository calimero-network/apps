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

const MAX_ALIGN_CELLS = 1_000_000; // bounds the alignment table a changed middle may build (2 MB)

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

type Step = '=' | '-' | '+';

/** The edit script turning `a` into `b` that keeps their longest common
 *  subsequence, so a letter both hold is never read as replaced. */
function align(a: AttrChar[], b: AttrChar[]): Step[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_ALIGN_CELLS) return replaceAll(a, b);
  const w = m + 1;
  const lcs = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[i].ch === b[j].ch ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const steps: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i].ch === b[j].ch) {
      steps.push('=');
      i += 1;
      j += 1;
    } else if (j >= m || (i < n && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
      steps.push('-');
      i += 1;
    } else {
      steps.push('+');
      j += 1;
    }
  }
  return steps;
}

const replaceAll = (a: AttrChar[], b: AttrChar[]): Step[] => [
  ...Array<Step>(a.length).fill('-'),
  ...Array<Step>(b.length).fill('+'),
];

/** `chars` as inserts, one per run of equal attributes, each carrying its set. */
function insertRuns(chars: AttrChar[]): Change[] {
  const ops: Change[] = [];
  let run = 0;
  while (run < chars.length) {
    let end = run + 1;
    while (end < chars.length && attrsEqual(chars[end].attrs, chars[run].attrs)) end += 1;
    ops.push({
      insert: chars
        .slice(run, end)
        .map((c) => c.ch)
        .join(''),
      attributes: { ...chars[run].attrs },
    });
    run = end;
  }
  return ops;
}

function isRetain(
  op: Change,
): op is { retain: number; attributes?: AttrDelta } {
  return 'retain' in op;
}

export interface DiffOptions {
  /** Keep letters both texts hold, for reading a peer's change, where a
   *  replaced middle would drop the identity of the reader's own letters. */
  keepShared?: boolean;
}

/** The minimal change list turning `prev` into `next`. */
export function diffSpans(prev: AttrSpan[], next: AttrSpan[], { keepShared = false }: DiffOptions = {}): Change[] {
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

  const middle = [before.slice(head, before.length - tail), after.slice(head, after.length - tail)] as const;
  const steps = keepShared ? align(...middle) : replaceAll(...middle);
  let was = head;
  let now = head;
  for (let k = 0; k < steps.length; ) {
    let end = k;
    while (end < steps.length && steps[end] === steps[k]) end += 1;
    const count = end - k;
    if (steps[k] === '=') {
      pushRetainRange(was, was + count, was - now);
      was += count;
      now += count;
    } else if (steps[k] === '-') {
      ops.push({ delete: count });
      was += count;
    } else {
      ops.push(...insertRuns(after.slice(now, now + count)));
      now += count;
    }
    k = end;
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

/**
 * `next` as one insert into `prev` at scalar `at`, or null when it is any other
 * edit. Unlike a diff, it places the insert even between identical characters.
 */
export function insertAt(prev: AttrSpan[], next: AttrSpan[], at: number): Change[] | null {
  const before = toChars(prev);
  const after = toChars(next);
  const count = after.length - before.length;
  if (count <= 0 || at > before.length) return null;
  for (let i = 0; i < before.length; i++) {
    const kept = after[i < at ? i : i + count];
    if (kept.ch !== before[i].ch || !attrsEqual(kept.attrs, before[i].attrs)) return null;
  }
  return [...(at > 0 ? [{ retain: at }] : []), ...insertRuns(after.slice(at, at + count))];
}

const plainText = (text: string): AttrSpan[] => [{ text, attributes: {} }];

const withoutAttrs = (ops: Change[]): Change[] => ops.map((op) => ('insert' in op ? { insert: op.insert } : op));

/** The change list for plain text, which the title API takes without attributes. */
export function diffText(prev: string, next: string, options: DiffOptions = {}): Change[] {
  return withoutAttrs(diffSpans(plainText(prev), plainText(next), options));
}

/** {@link insertAt} for plain text. */
export function insertTextAt(prev: string, next: string, at: number): Change[] | null {
  const ops = insertAt(plainText(prev), plainText(next), at);
  return ops && withoutAttrs(ops);
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
