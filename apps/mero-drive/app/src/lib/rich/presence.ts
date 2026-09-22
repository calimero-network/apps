// Live carets over the ephemeral channel. One docs context serves a whole
// folder and each author owns exactly one slot in it, so a slice names its
// document and both ends of the selection, and consumers filter by document.

import { COLOR_PRESETS } from '@/constants/config';

/** One author's caret: anchors, not positions, because a peer's text differs. */
export interface DocPresence {
  docId: string;
  blockId: string | null;
  anchor: string;
  head: string;
  name: string;
  colour: string;
}

/** The peers editing `docId`, with swept slots dropped. */
export function peersOnDoc<T extends { docId: string }>(
  peers: ReadonlyMap<string, T | undefined>,
  docId: string,
): Map<string, T> {
  const on = new Map<string, T>();
  for (const [author, slice] of peers) {
    if (slice && slice.docId === docId) on.set(author, slice);
  }
  return on;
}

/** The caret colour for an author, stable across sessions and peers. */
export function presenceColour(authorId: string): string {
  let hash = 0;
  for (let i = 0; i < authorId.length; i++) {
    hash = (hash * 31 + authorId.charCodeAt(i)) % COLOR_PRESETS.length;
  }
  return COLOR_PRESETS[hash].value;
}
