// The block walk, driven with a hand-built document in ProseMirror's shape so
// the positions are fixed numbers rather than whatever an editor happened to
// produce.
import { describe, it, expect } from 'vitest';
import { blockGeometry } from '../geometry';
import type { DocNode } from '../geometry';

function textNode(text: string): DocNode {
  return {
    isTextblock: false,
    isText: true,
    text,
    textContent: text,
    nodeSize: text.length,
    childCount: 0,
    child: () => {
      throw new Error('text nodes have no children');
    },
    descendants: () => {},
  };
}

function node(
  type: { textblock?: boolean; attrs?: Record<string, unknown> },
  children: DocNode[],
): DocNode {
  const self: DocNode = {
    attrs: type.attrs,
    isTextblock: type.textblock ?? false,
    isText: false,
    textContent: children.map((child) => child.textContent).join(''),
    nodeSize: children.reduce((sum, child) => sum + child.nodeSize, 2),
    childCount: children.length,
    child: (index) => children[index],
    descendants(fn) {
      let pos = 0;
      for (const child of children) {
        if (fn(child, pos) !== false) child.descendants(shift(fn, pos + 1));
        pos += child.nodeSize;
      }
    },
  };
  return self;
}

const shift =
  (fn: (n: DocNode, pos: number) => boolean | void, by: number) =>
  (n: DocNode, pos: number) =>
    fn(n, pos + by);

// doc > container(blk-1) > paragraph > "hello"
const simple = node({}, [
  node({ attrs: { id: 'blk-1' } }, [
    node({ textblock: true }, [textNode('hello')]),
  ]),
]);

describe('blockGeometry', () => {
  it('finds the first block and its content start', () => {
    expect(blockGeometry(simple, 'blk-1')).toEqual({
      contentStart: 2,
      text: 'hello',
      items: [{ text: 'hello', wrapped: false }],
    });
  });

  it('offsets the second block past the first', () => {
    const doc = node({}, [
      node({ attrs: { id: 'blk-1' } }, [
        node({ textblock: true }, [textNode('hello')]),
      ]),
      node({ attrs: { id: 'blk-2' } }, [
        node({ textblock: true }, [textNode('world')]),
      ]),
    ]);
    expect(blockGeometry(doc, 'blk-2')?.contentStart).toBe(11);
  });

  it('reports each inline run and whether it wraps', () => {
    const doc = node({}, [
      node({ attrs: { id: 'blk-1' } }, [
        node({ textblock: true }, [
          textNode('see '),
          node({}, [textNode('docs')]),
        ]),
      ]),
    ]);
    expect(blockGeometry(doc, 'blk-1')?.items).toEqual([
      { text: 'see ', wrapped: false },
      { text: 'docs', wrapped: true },
    ]);
  });

  it('is null for a block this replica does not have', () => {
    expect(blockGeometry(simple, 'blk-9')).toBeNull();
  });

  it('reads an empty block as an empty content run', () => {
    const doc = node({}, [
      node({ attrs: { id: 'blk-1' } }, [node({ textblock: true }, [])]),
    ]);
    expect(blockGeometry(doc, 'blk-1')).toEqual({
      contentStart: 2,
      text: '',
      items: [],
    });
  });
});
