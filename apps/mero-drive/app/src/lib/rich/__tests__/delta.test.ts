import { describe, it, expect } from 'vitest';
import { diffSpans, diffText, spansToInline, inlineToSpans } from '../delta';
import type { AttrSpan } from '../delta';

const plain = (text: string): AttrSpan[] => [{ text, attributes: {} }];

describe('diffSpans', () => {
  it('is empty when nothing changed', () => {
    expect(diffSpans(plain('hello'), plain('hello'))).toEqual([]);
  });

  it('types one character mid-word as a retain and an insert', () => {
    expect(diffSpans(plain('hello'), plain('helXlo'))).toEqual([
      { retain: 3 },
      { insert: 'X', attributes: {} },
    ]);
  });

  it('deletes a word as a retain and a delete', () => {
    expect(diffSpans(plain('the quick fox'), plain('the fox'))).toEqual([
      { retain: 4 },
      { delete: 6 },
    ]);
  });

  it('bolds a range with no text change as a retain with attributes', () => {
    const next: AttrSpan[] = [
      { text: 'hello ', attributes: {} },
      { text: 'world', attributes: { bold: 'true' } },
    ];
    expect(diffSpans(plain('hello world'), next)).toEqual([
      { retain: 6 },
      { retain: 5, attributes: { bold: 'true' } },
    ]);
  });

  it('unbolds a range as a retain nulling the key', () => {
    const prev: AttrSpan[] = [
      { text: 'hello ', attributes: {} },
      { text: 'world', attributes: { bold: 'true' } },
    ];
    expect(diffSpans(prev, plain('hello world'))).toEqual([
      { retain: 6 },
      { retain: 5, attributes: { bold: null } },
    ]);
  });

  it('types at the end of a bold run carrying the complete set', () => {
    const prev: AttrSpan[] = [
      { text: 'ab', attributes: { bold: 'true' } },
      { text: 'cd', attributes: {} },
    ];
    const next: AttrSpan[] = [
      { text: 'abX', attributes: { bold: 'true' } },
      { text: 'cd', attributes: {} },
    ];
    expect(diffSpans(prev, next)).toEqual([
      { retain: 2 },
      { insert: 'X', attributes: { bold: 'true' } },
    ]);
  });

  it('types unformatted at the end of a bold run stating an empty set', () => {
    const prev: AttrSpan[] = [{ text: 'ab', attributes: { bold: 'true' } }];
    const next: AttrSpan[] = [
      { text: 'ab', attributes: { bold: 'true' } },
      { text: 'X', attributes: {} },
    ];
    expect(diffSpans(prev, next)).toEqual([
      { retain: 2 },
      { insert: 'X', attributes: {} },
    ]);
  });

  it('replaces a selection as a delete then an insert', () => {
    expect(diffSpans(plain('hello world'), plain('hello there'))).toEqual([
      { retain: 6 },
      { delete: 5 },
      { insert: 'there', attributes: {} },
    ]);
  });

  it('inserts an astral emoji as one scalar', () => {
    expect(diffSpans(plain('hi'), plain('hi\u{1F44B}'))).toEqual([
      { retain: 2 },
      { insert: '\u{1F44B}', attributes: {} },
    ]);
  });

  it('deletes an astral emoji as one scalar, not two units', () => {
    expect(diffSpans(plain('a\u{1F44B}b'), plain('ab'))).toEqual([
      { retain: 1 },
      { delete: 1 },
    ]);
  });

  it('pastes 5000 characters as one insert op', () => {
    const pasted = 'x'.repeat(5000);
    const ops = diffSpans(plain(''), plain(pasted));
    expect(ops).toEqual([{ insert: pasted, attributes: {} }]);
  });

  it('splits an insert per attribute run', () => {
    const next: AttrSpan[] = [
      { text: 'a', attributes: {} },
      { text: 'b', attributes: { italic: 'true' } },
    ];
    expect(diffSpans(plain(''), next)).toEqual([
      { insert: 'a', attributes: {} },
      { insert: 'b', attributes: { italic: 'true' } },
    ]);
  });

  it('keeps a formatting change ahead of a text change in one op list', () => {
    const prev: AttrSpan[] = [{ text: 'abcd', attributes: {} }];
    const next: AttrSpan[] = [
      { text: 'ab', attributes: { bold: 'true' } },
      { text: 'cdZ', attributes: {} },
    ];
    expect(diffSpans(prev, next)).toEqual([
      { retain: 2, attributes: { bold: 'true' } },
      { retain: 2 },
      { insert: 'Z', attributes: {} },
    ]);
  });
});

describe('spansToInline', () => {
  it('renders a bold run as a styled text node', () => {
    const spans: AttrSpan[] = [
      { text: 'hello ', attributes: {} },
      { text: 'world', attributes: { bold: 'true' } },
    ];
    expect(spansToInline(spans)).toEqual([
      { type: 'text', text: 'hello ', styles: {} },
      { type: 'text', text: 'world', styles: { bold: true } },
    ]);
  });

  it('nests a link attribute into a link node', () => {
    const spans: AttrSpan[] = [
      { text: 'see ', attributes: {} },
      {
        text: 'docs',
        attributes: { bold: 'true', link: 'https://example.com' },
      },
    ];
    expect(spansToInline(spans)).toEqual([
      { type: 'text', text: 'see ', styles: {} },
      {
        type: 'link',
        href: 'https://example.com',
        content: [{ type: 'text', text: 'docs', styles: { bold: true } }],
      },
    ]);
  });

  it('merges adjacent spans carrying the same attributes', () => {
    const spans: AttrSpan[] = [
      { text: 'ab', attributes: { bold: 'true' } },
      { text: 'cd', attributes: { bold: 'true' } },
    ];
    expect(spansToInline(spans)).toEqual([
      { type: 'text', text: 'abcd', styles: { bold: true } },
    ]);
  });

  it('groups consecutive spans under one link node', () => {
    const spans: AttrSpan[] = [
      { text: 'do', attributes: { link: 'https://example.com' } },
      {
        text: 'cs',
        attributes: { link: 'https://example.com', italic: 'true' },
      },
    ];
    expect(spansToInline(spans)).toEqual([
      {
        type: 'link',
        href: 'https://example.com',
        content: [
          { type: 'text', text: 'do', styles: {} },
          { type: 'text', text: 'cs', styles: { italic: true } },
        ],
      },
    ]);
  });

  it('renders an empty span list as no inline content', () => {
    expect(spansToInline([])).toEqual([]);
  });
});

describe('inlineToSpans', () => {
  it('flattens styled text to spans', () => {
    expect(
      inlineToSpans([
        { type: 'text', text: 'hello ', styles: {} },
        { type: 'text', text: 'world', styles: { bold: true } },
      ]),
    ).toEqual([
      { text: 'hello ', attributes: {} },
      { text: 'world', attributes: { bold: 'true' } },
    ]);
  });

  it('pushes a link href down onto each child span', () => {
    expect(
      inlineToSpans([
        {
          type: 'link',
          href: 'https://example.com',
          content: [{ type: 'text', text: 'docs', styles: { bold: true } }],
        },
      ]),
    ).toEqual([
      {
        text: 'docs',
        attributes: { bold: 'true', link: 'https://example.com' },
      },
    ]);
  });

  it('drops an empty text node', () => {
    expect(
      inlineToSpans([{ type: 'text', text: '', styles: { bold: true } }]),
    ).toEqual([]);
  });

  it('round-trips a link through spansToInline unchanged', () => {
    const inline = [
      { type: 'text' as const, text: 'see ', styles: {} },
      {
        type: 'link' as const,
        href: 'https://example.com',
        content: [{ type: 'text' as const, text: 'docs', styles: {} }],
      },
    ];
    expect(spansToInline(inlineToSpans(inline))).toEqual(inline);
  });
});

describe('diffText', () => {
  it('types one character with no attributes on the op', () => {
    expect(diffText('hello', 'hello!')).toEqual([
      { retain: 5 },
      { insert: '!' },
    ]);
  });

  it('replaces the whole title as a delete and an insert', () => {
    expect(diffText('Untitled', 'Notes')).toEqual([
      { delete: 8 },
      { insert: 'Notes' },
    ]);
  });

  it('is empty when the title did not change', () => {
    expect(diffText('Notes', 'Notes')).toEqual([]);
  });

  it('counts an astral character as one scalar', () => {
    expect(diffText('a\u{1F44B}b', 'ab')).toEqual([
      { retain: 1 },
      { delete: 1 },
    ]);
  });
});
