// The assertion helpers, checked against literals and against the wrong
// literal: a helper that cannot fail proves nothing about the scenarios.

import { expect, test } from '@playwright/test';
import type { Block } from '../../src/generated/docs/DocsClient';
import {
  PARAGRAPH,
  blockText,
  codePointLength,
  documentText,
  occurrences,
  sameCharacterCounts,
  spanSummary,
} from './helpers/doc-model';
import { waitForValue } from './helpers/rpc';

const FOX: Block = {
  id: 'b1',
  kind: 'paragraph',
  depth: 0,
  attrs: {},
  spans: [
    { text: 'the ', attributes: {} },
    { text: 'quick', attributes: { bold: 'true' } },
    { text: ' fox', attributes: {} },
  ],
};

test.describe('doc model helpers', () => {
  test('blockText and documentText concatenate spans in order', () => {
    expect(blockText(FOX)).toBe('the quick fox');
    expect(blockText(FOX)).not.toBe('the fox quick');
    expect(documentText([FOX, { ...FOX, id: 'b2' }])).toBe('the quick foxthe quick fox');
  });

  test('spanSummary carries the marks, not just the text', () => {
    expect(spanSummary(FOX)).toEqual([':the ', 'bold=true:quick', ': fox']);
    expect(spanSummary(FOX)).not.toEqual([':the ', ':quick', ': fox']);
  });

  test('codePointLength counts an emoji once and a ZWJ sequence by its parts', () => {
    const rocket = String.fromCodePoint(0x1f680);
    expect(rocket.length).toBe(2); // UTF-16 units, the wrong count
    expect(codePointLength(rocket)).toBe(1);
    // woman + ZWJ + rocket: three code points, one rendered glyph.
    const astronaut = '\u{1F469}\u200D\u{1F680}';
    expect(codePointLength(astronaut)).toBe(3);
    expect(codePointLength(astronaut)).not.toBe(1);
  });

  test('occurrences counts contiguous passages, so interleaving shows up', () => {
    expect(occurrences('alphabeta', 'alpha')).toBe(1);
    expect(occurrences('albetapha', 'alpha')).toBe(0);
    expect(occurrences('alphaalpha', 'alpha')).toBe(2);
    expect(() => occurrences('x', '')).toThrow();
  });

  test('sameCharacterCounts rejects a dropped or duplicated character', () => {
    expect(sameCharacterCounts('abc', 'cab')).toBe(true);
    expect(sameCharacterCounts('abc', 'ab')).toBe(false);
    expect(sameCharacterCounts('abbc', 'abc')).toBe(false);
  });
});

test.describe('waitForValue', () => {
  test('returns as soon as the read matches', async () => {
    let calls = 0;
    await waitForValue(
      async () => ++calls,
      2,
      { timeout: 5_000, label: 'counter' },
    );
    expect(calls).toBe(2);
  });

  test('a wrong expected literal fails, and the message names the last value', async () => {
    await expect(
      waitForValue(async () => `${PARAGRAPH}{:fox};`, `${PARAGRAPH}{:cat};`, {
        timeout: 1_000,
        label: 'digest',
      }),
    ).rejects.toThrow(/digest never reached .*cat.*last was .*fox/s);
  });
});
