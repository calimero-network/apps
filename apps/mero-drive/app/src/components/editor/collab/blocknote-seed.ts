// Every replica of an empty doc starts from one shared initial block, so two
// first edits that overlap land in the same root instead of creating two.

import * as Y from 'yjs';

export const BLOCKNOTE_FRAGMENT = 'blocknote';

// FROZEN. Every blob in every log references these item ids (clientID 0);
// changing a byte re-reads existing docs against a different structure.
const EMPTY_DOC_SEED_B64 =
  'AQcAAAcBCWJsb2Nrbm90ZQMKYmxvY2tHcm91cAcAAAADDmJsb2NrQ29udGFpbmVyBwAAAQMJcGFyYWdyYXBoKAAAAg9iYWNrZ3JvdW5kQ29sb3IBdwdkZWZhdWx0KAAAAgl0ZXh0Q29sb3IBdwdkZWZhdWx0KAAAAg10ZXh0QWxpZ25tZW50AXcEbGVmdCgAAAECaWQBdw5pbml0aWFsQmxvY2tJZAA=';

// BlockNote's initial paragraph as y-prosemirror writes it; the readable
// construction lives in the golden test.
export const EMPTY_DOC_SEED: Uint8Array = Uint8Array.from(
  atob(EMPTY_DOC_SEED_B64),
  (c) => c.charCodeAt(0),
);

/**
 * Seed a hydrated doc whose fragment is still empty. `origin` is the provider,
 * so the seed is not buffered as a local edit; the first local flush writes it.
 */
export function seedEmptyDoc(doc: Y.Doc, origin: unknown): boolean {
  if (doc.getXmlFragment(BLOCKNOTE_FRAGMENT).length > 0) return false;
  Y.applyUpdate(doc, EMPTY_DOC_SEED, origin);
  return true;
}
