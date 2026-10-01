// Pasted or dropped HTML loses the blocks it may not bring in: an image whose
// url is an address rather than a blob, and the placeholder for a newer kind.

import { Plugin } from 'prosemirror-state';
import { parseBlobRef } from '@/lib/images';
import { UNSUPPORTED_BLOCK } from './schema';

const CANDIDATES = `[data-content-type="image"], [data-content-type="${UNSUPPORTED_BLOCK}"]`;
const BLOCK_ELEMENT = '[data-node-type="blockOuter"]'; // one block with its children, in BlockNote's HTML

const refused = (el: Element) =>
  el.getAttribute('data-content-type') !== 'image' ||
  !parseBlobRef(el.getAttribute('data-url') ?? '');

export function stripRefusedBlocks(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const drop = [...doc.querySelectorAll(CANDIDATES)].filter(refused);
  if (drop.length === 0) return html;
  for (const el of drop) (el.closest(BLOCK_ELEMENT) ?? el).remove();
  return doc.body.innerHTML;
}

export function pastedBlocks(): Plugin {
  return new Plugin({ props: { transformPastedHTML: stripRefusedBlocks } });
}
