/**
 * Cell notes: rich text the contract keeps as a CRDT, edited with Quill-style
 * deltas (keep, insert or delete characters, with formatting).
 *
 * Positions count characters as the contract does (Unicode scalar values),
 * not UTF-16 units, so an emoji is one position on both sides.
 */
import type { Span } from '../api/spreadsheet/SpreadsheetClient';

export type { Span };

/** Formatting set on a run: a value turns it on, `null` turns it off. */
export type NoteAttrs = Record<string, string | null>;

/** One step of an edit, exactly as `edit_note` takes it on the wire. */
export type NoteOp =
  | { retain: number; attributes?: NoteAttrs }
  | { insert: string; attributes?: NoteAttrs }
  | { delete: number };

/** The formatting the note editor offers, as the contract's mark keys. */
export const NOTE_MARKS = ['bold', 'italic', 'underline', 'strike', 'highlight'] as const;
export type NoteMark = (typeof NOTE_MARKS)[number];

const chars = (s: string) => Array.from(s);

/** The note's plain text. */
export function spansText(spans: readonly Span[]): string {
  return spans.map((s) => s.text).join('');
}

/**
 * The edit that turns `before` into `after`: keep the common start, delete
 * what differs, insert the replacement. One contiguous change, which is what
 * a keystroke, a paste or a cut is.
 */
export function textDiff(before: string, after: string): NoteOp[] {
  const { at, del, ins } = change(chars(before), chars(after));
  const ops: NoteOp[] = [];
  if (at > 0 && (del > 0 || ins.length > 0)) ops.push({ retain: at });
  if (del > 0) ops.push({ delete: del });
  if (ins.length > 0) ops.push({ insert: ins.join('') });
  return ops;
}

/** The one contiguous change from `a` to `b`: where, how much goes, what comes. */
function change(a: string[], b: string[]): { at: number; del: number; ins: string[] } {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at++;
  let endA = a.length;
  let endB = b.length;
  while (endA > at && endB > at && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  return { at, del: endA - at, ins: b.slice(at, endB) };
}

/**
 * The local edit (`base` → `local`) as it applies to `server`, which is
 * `base` with a collaborator's edit on top. Positions after their change move
 * by what it added or removed; text they already deleted is not deleted
 * again. So typing never lands in the wrong place because someone else typed
 * first.
 */
export function rebase(base: string, server: string, local: string): NoteOp[] {
  if (server === base) return textDiff(base, local);
  const b = chars(base);
  const theirs = change(b, chars(server));
  const mine = change(b, chars(local));
  const theirEnd = theirs.at + theirs.del;
  const shift = theirs.ins.length - theirs.del;
  const map = (p: number) => (p <= theirs.at ? p : p >= theirEnd ? p + shift : theirs.at + theirs.ins.length);

  // My deletion, minus what they already deleted, in server positions.
  const mineEnd = mine.at + mine.del;
  const pieces: { at: number; del: number }[] = [];
  const before = Math.min(mineEnd, theirs.at) - mine.at;
  if (before > 0) pieces.push({ at: mine.at, del: before });
  const afterStart = Math.max(mine.at, theirEnd);
  if (mineEnd > afterStart) pieces.push({ at: map(afterStart), del: mineEnd - afterStart });
  const insertAt = map(mine.at);

  const ops: NoteOp[] = [];
  let cursor = 0;
  const retainTo = (p: number) => { if (p > cursor) { ops.push({ retain: p - cursor }); cursor = p; } };
  let inserted = mine.ins.length === 0;
  for (const piece of pieces) {
    if (!inserted && insertAt <= piece.at) {
      retainTo(insertAt);
      ops.push({ insert: mine.ins.join('') });
      inserted = true;
    }
    retainTo(piece.at);
    ops.push({ delete: piece.del });
    cursor += piece.del;
  }
  if (!inserted) {
    retainTo(insertAt);
    ops.push({ insert: mine.ins.join('') });
  }
  return ops;
}

/** Turn `mark` on or off over characters `[start, end)`. */
export function formatOps(start: number, end: number, mark: NoteMark, on: boolean): NoteOp[] {
  if (end <= start) return [];
  const ops: NoteOp[] = [];
  if (start > 0) ops.push({ retain: start });
  ops.push({ retain: end - start, attributes: { [mark]: on ? 'true' : null } });
  return ops;
}

/** True when every character in `[start, end)` carries `mark`. */
export function hasMark(spans: readonly Span[], start: number, end: number, mark: NoteMark): boolean {
  if (end <= start) return false;
  let at = 0;
  for (const s of spans) {
    const len = chars(s.text).length;
    const from = Math.max(at, start);
    const to = Math.min(at + len, end);
    if (from < to && !s.attributes[mark]) return false;
    at += len;
  }
  return at >= end;
}

/** A UTF-16 offset into `text` as a character position. */
export function charOffset(text: string, utf16: number): number {
  return chars(text.slice(0, utf16)).length;
}
