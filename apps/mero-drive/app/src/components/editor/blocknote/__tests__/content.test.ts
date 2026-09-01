// Unit tests for the BlockNote storage-format layer. These are pure
// (no live editor / DOM) and pin the contract DocumentEditor relies on:
// stored content is a JSON `Block[]` string, empty/legacy content opens
// as a fresh document, and the plain-text walk feeds the status bar's
// word/character counts.

import { describe, it, expect } from 'vitest';
import {
  serializeBlocks,
  parseStoredContent,
  blocksToPlainText,
  countWords,
  countCharacters,
} from '../content';
import type { Block } from '@blocknote/core';

const sampleDoc = [
  { id: '1', type: 'heading', props: {}, content: [{ type: 'text', text: 'Title' }], children: [] },
  {
    id: '2',
    type: 'paragraph',
    props: {},
    content: [
      { type: 'text', text: 'hello ' },
      { type: 'link', href: 'https://x.test', content: [{ type: 'text', text: 'world' }] },
    ],
    children: [],
  },
] as unknown as Block[];

describe('parseStoredContent', () => {
  it('returns undefined for null / undefined / empty / whitespace', () => {
    expect(parseStoredContent(null)).toBeUndefined();
    expect(parseStoredContent(undefined)).toBeUndefined();
    expect(parseStoredContent('')).toBeUndefined();
    expect(parseStoredContent('   \n ')).toBeUndefined();
  });

  it('returns undefined for legacy HTML (nothing to migrate → fresh doc)', () => {
    expect(parseStoredContent('<h1>Old Tiptap doc</h1><p>body</p>')).toBeUndefined();
  });

  it('returns undefined for malformed JSON', () => {
    expect(parseStoredContent('{ not valid')).toBeUndefined();
  });

  it('returns undefined for an empty JSON array (a doc needs ≥1 block)', () => {
    expect(parseStoredContent('[]')).toBeUndefined();
  });

  it('returns undefined for a JSON object that is not an array', () => {
    expect(parseStoredContent('{"type":"paragraph"}')).toBeUndefined();
  });

  it('parses a non-empty JSON block array back into blocks', () => {
    const blocks = parseStoredContent(serializeBlocks(sampleDoc));
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks).toHaveLength(2);
    expect(blocks?.[0].type).toBe('heading');
  });
});

describe('serializeBlocks round-trip', () => {
  it('serialize → parse reproduces the document', () => {
    const round = parseStoredContent(serializeBlocks(sampleDoc));
    expect(round).toEqual(JSON.parse(serializeBlocks(sampleDoc)));
  });
});

describe('blocksToPlainText', () => {
  it('extracts text across blocks, including link inline content', () => {
    expect(blocksToPlainText(sampleDoc)).toBe('Title\nhello world');
  });

  it('recurses into nested children', () => {
    const nested = [
      {
        type: 'bulletListItem',
        content: [{ type: 'text', text: 'parent' }],
        children: [
          { type: 'bulletListItem', content: [{ type: 'text', text: 'child' }], children: [] },
        ],
      },
    ];
    expect(blocksToPlainText(nested)).toBe('parent\nchild');
  });

  it('skips empty blocks (images / tables) — no stray leading newline', () => {
    const weird = [
      { type: 'image', content: undefined, children: [] },
      { type: 'paragraph', content: [{ type: 'text', text: 'ok' }], children: [] },
    ];
    // The leading image contributes no text and must not inject a "\n".
    expect(blocksToPlainText(weird)).toBe('ok');
  });
});

describe('counts', () => {
  it('counts words ignoring extra whitespace', () => {
    expect(countWords('Title\nhello world')).toBe(3);
    expect(countWords('   ')).toBe(0);
    expect(countWords('')).toBe(0);
  });

  it('counts characters excluding inter-block newlines', () => {
    // "Title" (5) + "hello world" (11) = 16, newline excluded
    expect(countCharacters('Title\nhello world')).toBe(16);
  });
});
