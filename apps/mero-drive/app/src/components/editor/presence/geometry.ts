// Reading a block's position out of the live editor document. Typed against
// the shape of a ProseMirror node rather than the class, so the walk is
// testable without standing up an editor.

import type { BlockGeometry, InlineItem } from '@/lib/rich/cursors';

export interface DocNode {
  attrs?: Record<string, unknown>;
  isTextblock: boolean;
  isText: boolean;
  text?: string | null;
  textContent: string;
  nodeSize: number;
  childCount: number;
  child(index: number): DocNode;
  descendants(fn: (node: DocNode, pos: number) => boolean | void): void;
}

/** Where `blockId` sits in `doc`, or null when this replica has no such block. */
export function blockGeometry(
  doc: DocNode,
  blockId: string,
): BlockGeometry | null {
  let found = null as { node: DocNode; pos: number } | null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs?.id === blockId) found = { node, pos };
    return !found;
  });
  if (!found) return null;

  const textblock = found.node.isTextblock
    ? found
    : firstTextblock(found.node, found.pos + 1);
  if (!textblock) return null;

  const items: InlineItem[] = [];
  for (let i = 0; i < textblock.node.childCount; i++) {
    const child = textblock.node.child(i);
    items.push({
      text: child.isText ? (child.text ?? '') : child.textContent,
      wrapped: !child.isText,
    });
  }
  return {
    contentStart: textblock.pos + 1,
    text: textblock.node.textContent,
    items,
  };
}

function firstTextblock(
  node: DocNode,
  start: number,
): { node: DocNode; pos: number } | null {
  let pos = start;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.isTextblock) return { node: child, pos };
    pos += child.nodeSize;
  }
  return null;
}
