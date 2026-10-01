import { describe, it, expect } from 'vitest';
import { fromBlockNote, toBlockNote, backendBlocks } from '../blocknote';

describe('fromBlockNote', () => {
  it('flattens a nested list into depths', () => {
    const doc = [
      {
        id: 'a',
        type: 'bulletListItem',
        props: {},
        content: [{ type: 'text', text: 'one', styles: {} }],
        children: [
          {
            id: 'b',
            type: 'bulletListItem',
            props: {},
            content: [{ type: 'text', text: 'two', styles: {} }],
            children: [],
          },
        ],
      },
    ];
    expect(fromBlockNote(doc)).toEqual([
      {
        id: 'a',
        kind: 'bulletListItem',
        depth: 0,
        attrs: {},
        inline: [{ text: 'one', attributes: {} }],
      },
      {
        id: 'b',
        kind: 'bulletListItem',
        depth: 1,
        attrs: {},
        inline: [{ text: 'two', attributes: {} }],
      },
    ]);
  });

  it('carries props across as string attributes', () => {
    const doc = [
      {
        id: 'a',
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: 'Title', styles: {} }],
        children: [],
      },
    ];
    expect(fromBlockNote(doc)[0].attrs).toEqual({ level: '2' });
  });

  it('drops a prop the editor left at its default empty value', () => {
    const doc = [
      {
        id: 'a',
        type: 'paragraph',
        props: { textColor: 'default', backgroundColor: 'default' },
        content: [],
        children: [],
      },
    ];
    expect(fromBlockNote(doc)[0].attrs).toEqual({});
  });

  it('turns a link into a span attribute', () => {
    const doc = [
      {
        id: 'a',
        type: 'paragraph',
        props: {},
        content: [
          {
            type: 'link',
            href: 'https://example.com',
            content: [{ type: 'text', text: 'docs', styles: { bold: true } }],
          },
        ],
        children: [],
      },
    ];
    expect(fromBlockNote(doc)[0].inline).toEqual([
      {
        text: 'docs',
        attributes: { bold: 'true', link: 'https://example.com' },
      },
    ]);
  });
});

describe('toBlockNote', () => {
  it('nests a deeper block under the one before it', () => {
    const blocks = [
      {
        id: 'a',
        kind: 'bulletListItem',
        depth: 0,
        attrs: {},
        inline: [{ text: 'one', attributes: {} }],
      },
      {
        id: 'b',
        kind: 'bulletListItem',
        depth: 1,
        attrs: {},
        inline: [{ text: 'two', attributes: {} }],
      },
    ];
    expect(toBlockNote(blocks)).toEqual([
      {
        id: 'a',
        type: 'bulletListItem',
        props: {},
        content: [{ type: 'text', text: 'one', styles: {} }],
        children: [
          {
            id: 'b',
            type: 'bulletListItem',
            props: {},
            content: [{ type: 'text', text: 'two', styles: {} }],
            children: [],
          },
        ],
      },
    ]);
  });

  it('parses a numeric prop back out of its string attribute', () => {
    const blocks = [
      {
        id: 'a',
        kind: 'heading',
        depth: 0,
        attrs: { level: '2' },
        inline: [],
      },
    ];
    expect(toBlockNote(blocks)[0].props).toEqual({ level: 2 });
  });

  it('re-parents a block that jumps more than one level', () => {
    const blocks = [
      { id: 'a', kind: 'paragraph', depth: 0, attrs: {}, inline: [] },
      { id: 'b', kind: 'paragraph', depth: 5, attrs: {}, inline: [] },
    ];
    const doc = toBlockNote(blocks);
    expect(doc).toHaveLength(1);
    expect(doc[0].children).toHaveLength(1);
    expect(doc[0].children[0].id).toBe('b');
  });

  it('keeps a block at depth greater than zero with no parent at the top', () => {
    const blocks = [
      { id: 'a', kind: 'paragraph', depth: 3, attrs: {}, inline: [] },
    ];
    expect(toBlockNote(blocks).map((b) => b.id)).toEqual(['a']);
  });
});

describe('backendBlocks', () => {
  it('reads the backend document shape into editor blocks', () => {
    const rows = [
      {
        id: 'blk-1',
        kind: 'heading',
        depth: 0,
        attrs: { level: '1' },
        spans: [{ text: 'Title', attributes: { bold: 'true' } }],
      },
    ];
    expect(backendBlocks(rows)).toEqual([
      {
        id: 'blk-1',
        kind: 'heading',
        depth: 0,
        attrs: { level: '1' },
        inline: [{ text: 'Title', attributes: { bold: 'true' } }],
      },
    ]);
  });

  it('fills a span with no attributes', () => {
    const rows = [
      {
        id: 'blk-1',
        kind: 'paragraph',
        depth: 0,
        attrs: {},
        spans: [{ text: 'plain' }],
      },
    ];
    expect(backendBlocks(rows)[0].inline).toEqual([
      { text: 'plain', attributes: {} },
    ]);
  });
});
