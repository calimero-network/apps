// Where a peer's caret lands in this replica's editor. A peer publishes
// anchors, not positions, so by the time they arrive the text has moved; this
// turns the positions THIS replica resolved them to into editor coordinates.

import { scalarToUtf16 } from './offsets';

/** One inline run of a block; a wrapping node costs a token on each side. */
export interface InlineItem {
  text: string;
  wrapped: boolean;
}

/** One block as the editor currently holds it. */
export interface BlockGeometry {
  contentStart: number;
  text: string;
  items: InlineItem[];
}

/** One peer's caret, at the scalar positions this replica resolved. */
export interface PeerCaret {
  author: string;
  name: string;
  colour: string;
  blockId: string;
  anchor: number | null;
  head: number | null;
}

export type CaretDecoration =
  | {
      kind: 'caret';
      author: string;
      name: string;
      colour: string;
      pos: number;
    }
  | {
      kind: 'selection';
      author: string;
      name: string;
      colour: string;
      from: number;
      to: number;
    };

/** The offset inside a block's content for a UTF-16 offset into its text. */
export function inlineOffset(items: InlineItem[], utf16: number): number {
  let wanted = Math.max(utf16, 0);
  let offset = 0;
  for (const item of items) {
    if (wanted <= item.text.length) {
      return offset + (item.wrapped ? 1 : 0) + wanted;
    }
    wanted -= item.text.length;
    offset += item.wrapped ? item.text.length + 2 : item.text.length;
  }
  return offset;
}

/** One peer's caret in a plain text field, in UTF-16 offsets. */
export interface TitleCaret {
  author: string;
  name: string;
  colour: string;
  caret: number;
  from: number;
  to: number;
}

/** The peers to draw over a plain text field, at this replica's positions. */
export function titleCarets(
  peers: Omit<PeerCaret, 'blockId'>[],
  text: string,
): TitleCaret[] {
  const out: TitleCaret[] = [];
  for (const peer of [...peers].sort((a, b) => (a.author < b.author ? -1 : 1))) {
    if (peer.anchor === null || peer.head === null) continue;
    const anchor = scalarToUtf16(text, peer.anchor);
    const head = scalarToUtf16(text, peer.head);
    out.push({
      author: peer.author,
      name: peer.name,
      colour: peer.colour,
      caret: head,
      from: Math.min(anchor, head),
      to: Math.max(anchor, head),
    });
  }
  return out;
}

/** The UTF-16 text offset for an offset inside a block's content. */
export function textOffset(items: InlineItem[], inline: number): number {
  let wanted = Math.max(inline, 0);
  let text = 0;
  for (const item of items) {
    const span = item.wrapped ? item.text.length + 2 : item.text.length;
    if (wanted <= span) {
      return text + Math.min(Math.max(wanted - (item.wrapped ? 1 : 0), 0), item.text.length);
    }
    wanted -= span;
    text += item.text.length;
  }
  return text;
}

/** Every decoration to draw for the peers whose blocks this replica has. */
export function caretDecorations(
  peers: PeerCaret[],
  geometry: (blockId: string) => BlockGeometry | null,
): CaretDecoration[] {
  const out: CaretDecoration[] = [];
  for (const peer of [...peers].sort((a, b) => (a.author < b.author ? -1 : 1))) {
    const block = geometry(peer.blockId);
    if (!block || peer.anchor === null || peer.head === null) continue;
    const { author, name, colour } = peer;
    const at = (scalar: number) =>
      block.contentStart +
      inlineOffset(block.items, scalarToUtf16(block.text, scalar));
    const anchor = at(peer.anchor);
    const head = at(peer.head);
    if (anchor !== head) {
      out.push({
        kind: 'selection',
        author,
        name,
        colour,
        from: Math.min(anchor, head),
        to: Math.max(anchor, head),
      });
    }
    out.push({ kind: 'caret', author, name, colour, pos: head });
  }
  return out;
}
