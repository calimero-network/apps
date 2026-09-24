// Transform, position mapping and apply for the Quill-style change lists one
// block's text is edited through. Every length counts Unicode scalars, as the
// backend does, so a change built here lands where the backend expects it.

import { canonicalAttrs, type AttrDelta, type MarkAttrs } from './attributes';
import type { AttrSpan, Change } from './delta';

type Kind = 'retain' | 'insert' | 'delete';

const kindOf = (op: Change): Kind =>
  'retain' in op ? 'retain' : 'delete' in op ? 'delete' : 'insert';

const lengthOf = (op: Change): number =>
  'retain' in op
    ? op.retain
    : 'delete' in op
      ? op.delete
      : Array.from(op.insert).length;

/** Walks a change list, splitting any op at an arbitrary scalar length. */
class Cursor {
  private index = 0;
  private offset = 0;

  constructor(private readonly ops: Change[]) {}

  hasNext(): boolean {
    return this.index < this.ops.length;
  }

  // Past the end the list is an endless plain retain, which is what lets two
  // lists of different lengths be walked side by side.
  peekKind(): Kind {
    return this.hasNext() ? kindOf(this.ops[this.index]) : 'retain';
  }

  peekLength(): number {
    return this.hasNext()
      ? lengthOf(this.ops[this.index]) - this.offset
      : Infinity;
  }

  next(length = Infinity): Change {
    if (!this.hasNext()) return { retain: length };
    const op = this.ops[this.index];
    const take = Math.min(length, lengthOf(op) - this.offset);
    let out: Change;
    if ('delete' in op) out = { delete: take };
    else if ('retain' in op) {
      out = op.attributes
        ? { retain: take, attributes: op.attributes }
        : { retain: take };
    } else {
      const text = Array.from(op.insert)
        .slice(this.offset, this.offset + take)
        .join('');
      out = op.attributes
        ? { insert: text, attributes: op.attributes }
        : { insert: text };
    }
    if (this.offset + take === lengthOf(op)) {
      this.index += 1;
      this.offset = 0;
    } else {
      this.offset += take;
    }
    return out;
  }
}

const sameAttrs = (a?: AttrDelta, b?: AttrDelta): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Appends ops, merging neighbours of one kind and attribute set. */
class Builder {
  readonly ops: Change[] = [];

  push(op: Change): void {
    if (lengthOf(op) === 0) return;
    const last = this.ops[this.ops.length - 1];
    if (last && 'retain' in last && 'retain' in op) {
      if (sameAttrs(last.attributes, op.attributes)) {
        last.retain += op.retain;
        return;
      }
    } else if (last && 'delete' in last && 'delete' in op) {
      last.delete += op.delete;
      return;
    } else if (last && 'insert' in last && 'insert' in op) {
      if (sameAttrs(last.attributes, op.attributes)) {
        last.insert += op.insert;
        return;
      }
    }
    this.ops.push({ ...op });
  }

  retain(length: number, attributes?: AttrDelta): void {
    this.push(attributes ? { retain: length, attributes } : { retain: length });
  }

  /** The ops without a trailing plain retain, which names no change. */
  chop(): Change[] {
    const last = this.ops[this.ops.length - 1];
    if (last && 'retain' in last && !last.attributes) this.ops.pop();
    return this.ops;
  }
}

function transformAttrs(
  a: AttrDelta | undefined,
  b: AttrDelta | undefined,
  priority: boolean,
): AttrDelta | undefined {
  if (!a) return b;
  if (!b || !priority) return b;
  const kept: AttrDelta = {};
  for (const [key, value] of Object.entries(b)) {
    if (!(key in a)) kept[key] = value;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * `b` rewritten to apply after `a`, both built against the same text. With
 * `priority`, `a` is taken to have happened first: its inserts at a shared
 * position come first and its marks win a conflict.
 */
export function transform(a: Change[], b: Change[], priority: boolean): Change[] {
  const left = new Cursor(a);
  const right = new Cursor(b);
  const out = new Builder();
  while (left.hasNext() || right.hasNext()) {
    if (
      left.peekKind() === 'insert' &&
      (priority || right.peekKind() !== 'insert')
    ) {
      out.retain(lengthOf(left.next()));
    } else if (right.peekKind() === 'insert') {
      out.push(right.next());
    } else {
      const length = Math.min(left.peekLength(), right.peekLength());
      const mine = left.next(length);
      const theirs = right.next(length);
      if ('delete' in mine) continue;
      if ('delete' in theirs) out.push(theirs);
      else {
        out.retain(
          length,
          transformAttrs(
            'retain' in mine ? mine.attributes : undefined,
            'retain' in theirs ? theirs.attributes : undefined,
            priority,
          ),
        );
      }
    }
  }
  return out.chop();
}

/**
 * Where scalar position `index` moves once `ops` apply. An insert landing
 * exactly on it leaves it in place.
 */
export function transformPosition(ops: Change[], index: number): number {
  const cursor = new Cursor(ops);
  let offset = 0;
  let moved = index;
  while (cursor.hasNext() && offset <= moved) {
    const length = cursor.peekLength();
    const kind = cursor.peekKind();
    cursor.next();
    if (kind === 'delete') {
      moved -= Math.min(length, moved - offset);
      continue;
    }
    if (kind === 'insert' && offset < moved) moved += length;
    offset += length;
  }
  return moved;
}

/** The inserts of `ops` placed at scalar `at` instead, and where they end. */
export function moveInserts(ops: Change[], at: number): { ops: Change[]; end: number } {
  const inserts = ops.filter((op) => 'insert' in op);
  const end = inserts.reduce((sum, op) => sum + lengthOf(op), at);
  return { ops: at > 0 ? [{ retain: at }, ...inserts] : inserts, end };
}

interface Char {
  ch: string;
  attrs: MarkAttrs;
}

function withDelta(attrs: MarkAttrs, delta: AttrDelta): MarkAttrs {
  const next: MarkAttrs = { ...attrs };
  for (const [key, value] of Object.entries(delta)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return canonicalAttrs(next);
}

/** `spans` with `ops` applied; an insert takes exactly the attributes it carries. */
export function applyChanges(spans: AttrSpan[], ops: Change[]): AttrSpan[] {
  const chars: Char[] = [];
  for (const span of spans) {
    const attrs = canonicalAttrs(span.attributes);
    for (const ch of span.text) chars.push({ ch, attrs });
  }
  const out: Char[] = [];
  let at = 0;
  for (const op of ops) {
    if ('insert' in op) {
      const attrs = withDelta({}, op.attributes ?? {});
      for (const ch of op.insert) out.push({ ch, attrs });
    } else if ('delete' in op) {
      at += op.delete;
    } else {
      for (const char of chars.slice(at, at + op.retain)) {
        out.push(
          op.attributes
            ? { ch: char.ch, attrs: withDelta(char.attrs, op.attributes) }
            : char,
        );
      }
      at += op.retain;
    }
  }
  out.push(...chars.slice(at));

  const merged: AttrSpan[] = [];
  for (const { ch, attrs } of out) {
    const last = merged[merged.length - 1];
    if (last && JSON.stringify(last.attributes) === JSON.stringify(attrs)) {
      last.text += ch;
    } else {
      merged.push({ text: ch, attributes: attrs });
    }
  }
  return merged;
}
