import { describe, it, expect } from 'vitest';
import {
  caretDecorations,
  inlineOffset,
  textOffset,
  titleCarets,
} from '../cursors';
import type { BlockGeometry, PeerCaret } from '../cursors';

const text = (value: string) => ({ text: value, wrapped: false });

const geometry = (
  blocks: Record<string, BlockGeometry>,
): ((id: string) => BlockGeometry | null) =>
  (id) => blocks[id] ?? null;

const peer = (over: Partial<PeerCaret> = {}): PeerCaret => ({
  author: 'alice',
  name: 'Ada',
  colour: '#3b82f6',
  blockId: 'blk-1',
  anchor: 2,
  head: 2,
  ...over,
});

const block = (value: string, contentStart = 1): BlockGeometry => ({
  contentStart,
  text: value,
  items: [text(value)],
});

describe('inlineOffset', () => {
  it('is the UTF-16 offset when the block is one text run', () => {
    expect(inlineOffset([text('hello')], 3)).toBe(3);
  });

  it('adds nothing across two adjacent text runs', () => {
    expect(inlineOffset([text('he'), text('llo')], 4)).toBe(4);
  });

  it('keeps a caret at a wrapping node boundary outside the node', () => {
    const items = [text('see '), { text: 'docs', wrapped: true }];
    expect(inlineOffset(items, 4)).toBe(4);
  });

  it('steps over the open token to reach inside a wrapping node', () => {
    const items = [text('see '), { text: 'docs', wrapped: true }];
    expect(inlineOffset(items, 6)).toBe(7);
  });

  it('steps over a whole wrapping node to reach the run after it', () => {
    const items = [{ text: 'ab', wrapped: true }, text('cd')];
    expect(inlineOffset(items, 2)).toBe(3);
    expect(inlineOffset(items, 3)).toBe(5);
  });

  it('clamps an offset past the end to the end of the content', () => {
    expect(inlineOffset([text('hi')], 99)).toBe(2);
    expect(inlineOffset([text('hi')], -3)).toBe(0);
  });

  it('is zero for a block with no inline content', () => {
    expect(inlineOffset([], 4)).toBe(0);
  });
});

describe('textOffset', () => {
  it('is the inline offset when the block is one text run', () => {
    expect(textOffset([text('hello')], 3)).toBe(3);
  });

  it('drops the open token of a wrapping node', () => {
    const items = [text('see '), { text: 'docs', wrapped: true }];
    expect(textOffset(items, 7)).toBe(6);
  });

  it('inverts inlineOffset across a wrapping node', () => {
    const items = [{ text: 'ab', wrapped: true }, text('cd')];
    expect(textOffset(items, inlineOffset(items, 3))).toBe(3);
    expect(textOffset(items, inlineOffset(items, 1))).toBe(1);
  });

  it('clamps past the end of the content', () => {
    expect(textOffset([text('hi')], 99)).toBe(2);
    expect(textOffset([text('hi')], -1)).toBe(0);
  });
});

describe('titleCarets', () => {
  const who = { author: 'alice', name: 'Ada', colour: '#3b82f6' };

  it('places a collapsed caret at its UTF-16 offset', () => {
    expect(titleCarets([{ ...who, anchor: 3, head: 3 }], 'hello')).toEqual([
      { ...who, caret: 3, from: 3, to: 3 },
    ]);
  });

  it('counts an astral character as two units', () => {
    expect(
      titleCarets([{ ...who, anchor: 2, head: 2 }], 'a\u{1F44B}b'),
    ).toEqual([{ ...who, caret: 3, from: 3, to: 3 }]);
  });

  it('orders a backwards selection and keeps the caret at the head', () => {
    expect(titleCarets([{ ...who, anchor: 4, head: 1 }], 'hello')).toEqual([
      { ...who, caret: 1, from: 1, to: 4 },
    ]);
  });

  it('skips an anchor this replica cannot place yet', () => {
    expect(titleCarets([{ ...who, anchor: null, head: 2 }], 'hello')).toEqual(
      [],
    );
  });

  it('orders peers by author so the row is stable', () => {
    const out = titleCarets(
      [
        { ...who, author: 'carol', anchor: 1, head: 1 },
        { ...who, author: 'bob', anchor: 2, head: 2 },
      ],
      'hello',
    );
    expect(out.map((caret) => caret.author)).toEqual(['bob', 'carol']);
  });
});

describe('caretDecorations', () => {
  it('draws a caret at the head for a collapsed selection', () => {
    const blocks = geometry({ 'blk-1': block('hello') });
    expect(caretDecorations([peer()], blocks)).toEqual([
      {
        kind: 'caret',
        author: 'alice',
        name: 'Ada',
        colour: '#3b82f6',
        pos: 3,
      },
    ]);
  });

  it('draws a selection and a caret when anchor and head differ', () => {
    const blocks = geometry({ 'blk-1': block('hello world') });
    expect(caretDecorations([peer({ anchor: 0, head: 5 })], blocks)).toEqual([
      {
        kind: 'selection',
        author: 'alice',
        name: 'Ada',
        colour: '#3b82f6',
        from: 1,
        to: 6,
      },
      {
        kind: 'caret',
        author: 'alice',
        name: 'Ada',
        colour: '#3b82f6',
        pos: 6,
      },
    ]);
  });

  it('orders a backwards selection without moving the caret', () => {
    const blocks = geometry({ 'blk-1': block('hello world') });
    const out = caretDecorations([peer({ anchor: 5, head: 0 })], blocks);
    expect(out).toEqual([
      {
        kind: 'selection',
        author: 'alice',
        name: 'Ada',
        colour: '#3b82f6',
        from: 1,
        to: 6,
      },
      {
        kind: 'caret',
        author: 'alice',
        name: 'Ada',
        colour: '#3b82f6',
        pos: 1,
      },
    ]);
  });

  it('counts an astral character as one scalar and two units', () => {
    const blocks = geometry({ 'blk-1': block('a\u{1F44B}b') });
    expect(caretDecorations([peer({ anchor: 2, head: 2 })], blocks)).toEqual([
      {
        kind: 'caret',
        author: 'alice',
        name: 'Ada',
        colour: '#3b82f6',
        pos: 4,
      },
    ]);
  });

  it('offsets by the block content start, not the document start', () => {
    const blocks = geometry({ 'blk-1': block('hello', 42) });
    expect(caretDecorations([peer({ anchor: 1, head: 1 })], blocks)[0]).toEqual(
      { kind: 'caret', author: 'alice', name: 'Ada', colour: '#3b82f6', pos: 43 },
    );
  });

  it('skips an anchor this replica cannot place yet rather than drawing at 0', () => {
    const blocks = geometry({ 'blk-1': block('hello') });
    expect(caretDecorations([peer({ anchor: null, head: null })], blocks)).toEqual(
      [],
    );
    expect(caretDecorations([peer({ anchor: null, head: 2 })], blocks)).toEqual(
      [],
    );
  });

  it('skips a peer whose block is not in this document', () => {
    const blocks = geometry({ 'blk-1': block('hello') });
    expect(caretDecorations([peer({ blockId: 'blk-9' })], blocks)).toEqual([]);
  });

  it('draws every peer, ordered by author so the set is stable', () => {
    const blocks = geometry({ 'blk-1': block('hello') });
    const out = caretDecorations(
      [
        peer({ author: 'carol', name: 'Cy', anchor: 1, head: 1 }),
        peer({ author: 'bob', name: 'Bo', anchor: 4, head: 4 }),
      ],
      blocks,
    );
    expect(out.map((d) => d.author)).toEqual(['bob', 'carol']);
  });
});
