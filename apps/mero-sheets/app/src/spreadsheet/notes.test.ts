import { describe, expect, it } from 'vitest';
import { charOffset, formatOps, hasMark, rebase, spansText, textDiff, type NoteOp, type Span } from './notes';

const span = (text: string, attributes: Record<string, string> = {}): Span => ({ text, attributes });

describe('textDiff', () => {
  it('is empty when nothing changed', () => {
    expect(textDiff('same', 'same')).toEqual([]);
  });

  it('keeps the common start and inserts the rest', () => {
    expect(textDiff('check', 'check totals')).toEqual([{ retain: 5 }, { insert: ' totals' }]);
    expect(textDiff('', 'hi')).toEqual([{ insert: 'hi' }]);
  });

  it('replaces the differing middle', () => {
    expect(textDiff('check the totals', 'check all totals')).toEqual([
      { retain: 6 }, { delete: 3 }, { insert: 'all' },
    ]);
  });

  it('deletes without inserting', () => {
    expect(textDiff('abcdef', 'abef')).toEqual([{ retain: 2 }, { delete: 2 }]);
    expect(textDiff('abc', '')).toEqual([{ delete: 3 }]);
  });

  it('counts an emoji as one character, like the contract', () => {
    expect(textDiff('a😀b', 'a😀cb')).toEqual([{ retain: 2 }, { insert: 'c' }]);
  });
});

describe('formatOps', () => {
  it('sets a mark over a range, or clears it', () => {
    expect(formatOps(2, 5, 'bold', true)).toEqual([{ retain: 2 }, { retain: 3, attributes: { bold: 'true' } }]);
    expect(formatOps(0, 1, 'italic', false)).toEqual([{ retain: 1, attributes: { italic: null } }]);
    expect(formatOps(3, 3, 'bold', true)).toEqual([]);
  });
});

describe('hasMark', () => {
  const spans = [span('ab'), span('cd', { bold: 'true' }), span('ef')];
  it('is true only when every character in the range has the mark', () => {
    expect(hasMark(spans, 2, 4, 'bold')).toBe(true);
    expect(hasMark(spans, 1, 4, 'bold')).toBe(false);
    expect(hasMark(spans, 2, 2, 'bold')).toBe(false);
  });
  it('is false for a range past the end', () => {
    expect(hasMark(spans, 4, 9, 'bold')).toBe(false);
  });
});

describe('text and offsets', () => {
  it('joins spans and counts UTF-16 offsets as characters', () => {
    expect(spansText([span('a'), span('b')])).toBe('ab');
    expect(charOffset('😀x', 2)).toBe(1);
  });
});

/** Apply a delta to plain text, as the contract does to the note's characters. */
function apply(text: string, ops: NoteOp[]): string {
  const src = Array.from(text);
  const out: string[] = [];
  let at = 0;
  for (const op of ops) {
    if ('retain' in op) { out.push(...src.slice(at, at + op.retain)); at += op.retain; }
    else if ('delete' in op) at += op.delete;
    else out.push(op.insert);
  }
  out.push(...src.slice(at));
  return out.join('');
}

describe('rebase', () => {
  it('is the plain diff when nobody else changed the note', () => {
    expect(rebase('abc', 'abc', 'abXc')).toEqual(textDiff('abc', 'abXc'));
  });

  it('moves my typing past text a collaborator added before it', () => {
    const base = 'check the totals';
    const server = 'URGENT: check the totals';
    const local = 'check the totals today';
    expect(apply(server, rebase(base, server, local))).toBe('URGENT: check the totals today');
  });

  it('leaves my typing where it is when their change comes after it', () => {
    expect(apply('abc!!', rebase('abc', 'abc!!', 'Xabc'))).toBe('Xabc!!');
  });

  it('does not delete again what they already deleted', () => {
    // They deleted "cd"; I deleted "bcde" and typed "Z".
    expect(apply('abef', rebase('abcdef', 'abef', 'aZf'))).toBe('aZf');
  });

  it('keeps both inserts at the same place', () => {
    expect(apply('abXc', rebase('abc', 'abXc', 'abYc'))).toBe('abYXc');
  });
});
