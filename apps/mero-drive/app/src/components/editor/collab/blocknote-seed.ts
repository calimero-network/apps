// y-prosemirror writes the editor's initial block into an empty fragment on the
// first edit, so two replicas that edit before syncing create two roots; the
// view renders one and the next edit deletes the other writer's text.

import * as Y from 'yjs';

export const BLOCKNOTE_FRAGMENT = 'blocknote';
// Fixed clientID makes the seed byte-identical on every replica, so concurrent
// seeds are one set of Yjs items, not two competing roots.
const SEED_CLIENT_ID = 0;
// BlockNote's own id for the initial block when collaboration is enabled.
const INITIAL_BLOCK_ID = 'initialBlockId';

// The shape y-prosemirror writes for BlockNote's initial paragraph; a drift
// test pins it so an attribute change upstream is caught, not silently re-written.
function buildSeed(): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = SEED_CLIENT_ID;
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.setAttribute('backgroundColor', 'default');
  paragraph.setAttribute('textColor', 'default');
  paragraph.setAttribute('textAlignment', 'left');
  const container = new Y.XmlElement('blockContainer');
  container.setAttribute('id', INITIAL_BLOCK_ID);
  container.insert(0, [paragraph]);
  const group = new Y.XmlElement('blockGroup');
  group.insert(0, [container]);
  doc.getXmlFragment(BLOCKNOTE_FRAGMENT).insert(0, [group]);
  return Y.encodeStateAsUpdate(doc);
}

const EMPTY_DOC_SEED = buildSeed();

/**
 * Seed a hydrated doc whose fragment is still empty. `origin` is the provider,
 * so the seed counts as remote and is never appended to the log.
 */
export function seedEmptyDoc(doc: Y.Doc, origin: unknown): boolean {
  if (doc.getXmlFragment(BLOCKNOTE_FRAGMENT).length > 0) return false;
  Y.applyUpdate(doc, EMPTY_DOC_SEED, origin);
  return true;
}
