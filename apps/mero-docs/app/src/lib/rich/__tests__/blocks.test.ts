import { describe, it, expect } from 'vitest';
import { diffBlocks, placeholderFor, isPlaceholder } from '../blocks';
import type { EditorBlock } from '../blocks';

const block = (
  id: string,
  text: string,
  extra: Partial<EditorBlock> = {},
): EditorBlock => ({
  id,
  kind: 'paragraph',
  depth: 0,
  attrs: {},
  inline: text ? [{ text, attributes: {} }] : [],
  ...extra,
});

describe('placeholders', () => {
  it('names a block the backend has not minted yet', () => {
    expect(placeholderFor('b')).toBe('new:b');
    expect(isPlaceholder('new:b')).toBe(true);
    expect(isPlaceholder('b')).toBe(false);
  });
});

describe('diffBlocks', () => {
  it('is empty when nothing changed', () => {
    const prev = [block('a', 'hello')];
    expect(diffBlocks(prev, [block('a', 'hello')])).toEqual([]);
  });

  it('turns Enter in the middle of a paragraph into one split', () => {
    const prev = [block('a', 'hello world')];
    const next = [block('a', 'hello '), block('b', 'world')];
    expect(diffBlocks(prev, next)).toEqual([
      { call: 'split_block', block: 'a', at: 6, ref: 'new:b' },
    ]);
  });

  it('splits at a scalar position, not a UTF-16 one', () => {
    const prev = [block('a', 'a\u{1F44B}b')];
    const next = [block('a', 'a\u{1F44B}'), block('b', 'b')];
    expect(diffBlocks(prev, next)).toEqual([
      { call: 'split_block', block: 'a', at: 2, ref: 'new:b' },
    ]);
  });

  it('carries the new kind and props of a split out of a heading', () => {
    const prev = [
      block('a', 'title text', { kind: 'heading', attrs: { level: '1' } }),
    ];
    const next = [
      block('a', 'title ', { kind: 'heading', attrs: { level: '1' } }),
      block('b', 'text'),
    ];
    expect(diffBlocks(prev, next)).toEqual([
      { call: 'split_block', block: 'a', at: 6, ref: 'new:b' },
      { call: 'set_kind', block: 'new:b', kind: 'paragraph' },
      { call: 'set_attr', block: 'new:b', key: 'level', value: null },
    ]);
  });

  it('turns Backspace at a block start into one merge', () => {
    const prev = [block('a', 'hello '), block('b', 'world')];
    const next = [block('a', 'hello world')];
    expect(diffBlocks(prev, next)).toEqual([
      { call: 'merge_blocks', first: 'a', second: 'b' },
    ]);
  });

  it('turns Tab into a depth change', () => {
    const prev = [block('a', 'item', { kind: 'bulletListItem' })];
    const next = [block('a', 'item', { kind: 'bulletListItem', depth: 1 })];
    expect(diffBlocks(prev, next)).toEqual([
      { call: 'set_depth', block: 'a', depth: 1 },
    ]);
  });

  it('turns a paragraph into a heading with its level prop', () => {
    const prev = [block('a', 'title')];
    const next = [
      block('a', 'title', { kind: 'heading', attrs: { level: '2' } }),
    ];
    expect(diffBlocks(prev, next)).toEqual([
      { call: 'set_kind', block: 'a', kind: 'heading' },
      { call: 'set_attr', block: 'a', key: 'level', value: '2' },
    ]);
  });

  it('turns a drag to the front into one move', () => {
    const prev = [block('a', 'A'), block('b', 'B'), block('c', 'C')];
    const next = [block('b', 'B'), block('a', 'A'), block('c', 'C')];
    expect(diffBlocks(prev, next)).toEqual([
      { call: 'move_block', block: 'b', after: null },
    ]);
  });

  it('names the preceding block when moving into the middle', () => {
    const prev = [block('a', 'A'), block('b', 'B'), block('c', 'C')];
    const next = [block('a', 'A'), block('c', 'C'), block('b', 'B')];
    expect(diffBlocks(prev, next)).toEqual([
      { call: 'move_block', block: 'c', after: 'a' },
    ]);
  });

  it('turns a plain edit into an apply_delta only', () => {
    const prev = [block('a', 'hello')];
    const next = [block('a', 'hello!')];
    expect(diffBlocks(prev, next)).toEqual([
      {
        call: 'apply_delta',
        block: 'a',
        base: 'hello',
        ops: [{ retain: 5 }, { insert: '!', attributes: {} }],
      },
    ]);
  });

  it('inserts an unrelated new block and fills it with one delta', () => {
    const prev = [block('a', 'hello')];
    const next = [block('a', 'hello'), block('c', 'world')];
    expect(diffBlocks(prev, next)).toEqual([
      {
        call: 'insert_block',
        after: 'a',
        kind: 'paragraph',
        depth: 0,
        ref: 'new:c',
      },
      {
        call: 'apply_delta',
        block: 'new:c',
        base: '',
        ops: [{ insert: 'world', attributes: {} }],
      },
    ]);
  });

  it('inserts a first block with a null predecessor', () => {
    expect(diffBlocks([], [block('a', 'hi')])).toEqual([
      {
        call: 'insert_block',
        after: null,
        kind: 'paragraph',
        depth: 0,
        ref: 'new:a',
      },
      {
        call: 'apply_delta',
        block: 'new:a',
        base: '',
        ops: [{ insert: 'hi', attributes: {} }],
      },
    ]);
  });

  it('deletes a removed block', () => {
    const prev = [block('a', 'A'), block('b', 'B')];
    expect(diffBlocks(prev, [block('a', 'A')])).toEqual([
      { call: 'delete_block', block: 'b' },
    ]);
  });

  it('emits set_attr per changed key, sorted, nulling a removed one', () => {
    const prev = [block('a', 'x', { attrs: { textAlignment: 'left' } })];
    const next = [
      block('a', 'x', { attrs: { checked: 'true', textAlignment: 'center' } }),
    ];
    expect(diffBlocks(prev, next)).toEqual([
      { call: 'set_attr', block: 'a', key: 'checked', value: 'true' },
      { call: 'set_attr', block: 'a', key: 'textAlignment', value: 'center' },
    ]);
  });

  it('formats across a split without re-sending the text', () => {
    const prev = [block('a', 'hello world')];
    const next = [
      block('a', 'hello '),
      {
        ...block('b', ''),
        inline: [{ text: 'world', attributes: { bold: 'true' } }],
      },
    ];
    expect(diffBlocks(prev, next)).toEqual([
      { call: 'split_block', block: 'a', at: 6, ref: 'new:b' },
      {
        call: 'apply_delta',
        block: 'new:b',
        base: 'world',
        ops: [{ retain: 5, attributes: { bold: 'true' } }],
      },
    ]);
  });
});
