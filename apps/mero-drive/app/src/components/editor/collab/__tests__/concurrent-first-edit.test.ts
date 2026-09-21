// Two headless BlockNote editors, two providers, one shared log: both replicas
// make their first edit before seeing the other's, which is the case that
// produced two roots and lost one writer's text.

import {
  assert,
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { BlockNoteEditor } from '@blocknote/core';
import { schema } from '../../blocknote/schema';
import { blocksToPlainText } from '../../blocknote/content';
import {
  CalimeroYjsProvider,
  type CalimeroYjsTransport,
} from '../CalimeroYjsProvider';
import {
  BLOCKNOTE_FRAGMENT,
  EMPTY_DOC_SEED,
  seedEmptyDoc,
} from '../blocknote-seed';

const fastOpts = { flushDebounceMs: 5, retryBackoffMs: 1, maxFlushRetries: 1 };
const FROZEN_SEED_MESSAGE =
  'EMPTY_DOC_SEED is frozen: existing blobs reference its item ids. ' +
  'Never change the seed; fix the reference construction or the caller.';

type Editor = BlockNoteEditor<any, any, any>;

// The docs WASM stands in as one add-only set keyed by blob bytes, which is
// how `content_updates` keys entries (compute_id over the value).
function sharedLog() {
  const log = new Map<string, Uint8Array>();
  return {
    log,
    transport: {
      appendDocUpdate: async (u: Uint8Array) => {
        log.set(u.join(','), u.slice());
      },
      getDocUpdates: async () => [...log.values()].map((u) => u.slice()),
    },
  };
}

function fold(log: Map<string, Uint8Array>): Y.Doc {
  const doc = new Y.Doc();
  for (const u of log.values()) Y.applyUpdate(doc, u);
  return doc;
}

const fragmentText = (doc: Y.Doc) =>
  doc.getXmlFragment(BLOCKNOTE_FRAGMENT).toString();

function createEditor(doc: Y.Doc, name: string): Editor {
  const editor = BlockNoteEditor.create({
    schema,
    collaboration: {
      fragment: doc.getXmlFragment(BLOCKNOTE_FRAGMENT),
      user: { name, color: '#000000' },
      provider: { awareness: new Awareness(doc) },
    },
  });
  editor.mount(document.createElement('div'));
  return editor;
}

// Mirrors useCollabDoc: hydrate, seed if still empty, write the seed ahead of
// the first local edit. `seed: false` stands in for a client without the fix.
async function openReplica(
  transport: CalimeroYjsTransport,
  name: string,
  { seed = true } = {},
) {
  const doc = new Y.Doc();
  let persistSeed = false;
  const provider = new CalimeroYjsProvider(
    doc,
    {
      appendDocUpdate: async (update) => {
        if (persistSeed) {
          await transport.appendDocUpdate(EMPTY_DOC_SEED);
          persistSeed = false;
        }
        await transport.appendDocUpdate(update);
      },
      getDocUpdates: () => transport.getDocUpdates(),
    },
    fastOpts,
  );
  await provider.pullRemote();
  if (seed) persistSeed = seedEmptyDoc(doc, provider);
  const editor = createEditor(doc, name);
  return { doc, provider, editor };
}

function typeAtStart(editor: Editor, text: string) {
  editor.setTextCursorPosition(editor.document[0], 'start');
  editor.insertInlineContent(text);
}

const text = (editor: Editor) => blocksToPlainText(editor.document);

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('concurrent first edits on an empty doc', () => {
  it('both writers survive in both editors and in the log', async () => {
    const { log, transport } = sharedLog();
    const alice = await openReplica(transport, 'alice');
    const bob = await openReplica(transport, 'bob');

    typeAtStart(alice.editor, 'AAA-from-alice ');
    typeAtStart(bob.editor, 'BBB-from-bob ');
    await alice.provider.flush();
    await bob.provider.flush();
    await alice.provider.pullRemote();
    await bob.provider.pullRemote();

    for (const r of [alice, bob]) {
      expect(text(r.editor)).toContain('AAA-from-alice');
      expect(text(r.editor)).toContain('BBB-from-bob');
      expect(r.doc.getXmlFragment(BLOCKNOTE_FRAGMENT).length).toBe(1);
    }

    // The next keystroke writes the view back into the fragment; a view that
    // dropped a root would delete it from the log for everyone.
    typeAtStart(alice.editor, 'more ');
    await alice.provider.flush();
    expect(fragmentText(fold(log))).toContain('BBB-from-bob');
    expect(fragmentText(fold(log))).toContain('AAA-from-alice');

    alice.editor.unmount();
    bob.editor.unmount();
  });

  it('writes the seed once for all replicas, so a raw fold of the log is complete', async () => {
    const { log, transport } = sharedLog();
    const alice = await openReplica(transport, 'alice');
    const bob = await openReplica(transport, 'bob');
    typeAtStart(alice.editor, 'AAA ');
    typeAtStart(bob.editor, 'BBB ');
    await alice.provider.flush();
    await bob.provider.flush();

    const seeds = [...log.values()].filter(
      (u) => u.join(',') === EMPTY_DOC_SEED.join(','),
    );
    expect(seeds).toHaveLength(1);
    expect(log.size).toBe(3);
    // No reader-side seed: the log alone reconstructs the doc.
    const folded = fold(log);
    expect(folded.store.pendingStructs).toBeNull();
    expect(fragmentText(folded)).toContain('AAA');
    expect(fragmentText(folded)).toContain('BBB');

    alice.editor.unmount();
    bob.editor.unmount();
  });

  it('a replica that never edits writes nothing', async () => {
    const { log, transport } = sharedLog();
    const viewer = await openReplica(transport, 'viewer');
    await viewer.provider.flush();
    expect(log.size).toBe(0);
    viewer.editor.unmount();
  });

  it('a pre-seed client root beside a seeded edit leaves nothing pending', async () => {
    // An old client (no seed) and a new client each make the first edit on
    // their own copy; a fresh reader then folds the union of both logs.
    const oldSide = sharedLog();
    const old = await openReplica(oldSide.transport, 'old', { seed: false });
    typeAtStart(old.editor, 'OLD ');
    await old.provider.flush();

    const newSide = sharedLog();
    const fresh = await openReplica(newSide.transport, 'new');
    typeAtStart(fresh.editor, 'NEW ');
    await fresh.provider.flush();

    const union = new Map([...oldSide.log, ...newSide.log]);
    const reader = fold(union);
    seedEmptyDoc(reader, 'reader');
    expect(reader.store.pendingStructs).toBeNull();
    expect(fragmentText(reader)).toContain('OLD');
    expect(fragmentText(reader)).toContain('NEW');

    old.editor.unmount();
    fresh.editor.unmount();
  });
});

describe('EMPTY_DOC_SEED', () => {
  it("is exactly BlockNote's initial paragraph built under clientID 0", () => {
    const doc = new Y.Doc();
    doc.clientID = 0;
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.setAttribute('backgroundColor', 'default');
    paragraph.setAttribute('textColor', 'default');
    paragraph.setAttribute('textAlignment', 'left');
    const container = new Y.XmlElement('blockContainer');
    container.setAttribute('id', 'initialBlockId');
    container.insert(0, [paragraph]);
    const group = new Y.XmlElement('blockGroup');
    group.insert(0, [container]);
    doc.getXmlFragment(BLOCKNOTE_FRAGMENT).insert(0, [group]);
    assert.deepEqual(
      Array.from(Y.encodeStateAsUpdate(doc)),
      Array.from(EMPTY_DOC_SEED),
      FROZEN_SEED_MESSAGE,
    );
  });

  it('still matches the structure y-prosemirror writes for a fresh BlockNote doc', () => {
    const doc = new Y.Doc();
    const editor = createEditor(doc, 'x');
    typeAtStart(editor, 'x');
    editor.unmount();

    const seeded = new Y.Doc();
    seedEmptyDoc(seeded, 'x');
    const shape = (el: Y.XmlElement): unknown => ({
      name: el.nodeName,
      attrs: el.getAttributes(),
      children: el
        .toArray()
        .filter((c): c is Y.XmlElement => c instanceof Y.XmlElement)
        .map(shape),
    });
    const root = (d: Y.Doc) =>
      shape(d.getXmlFragment(BLOCKNOTE_FRAGMENT).get(0) as Y.XmlElement);
    // Early warning only: an upstream change here means the first edit on a
    // seeded doc rewrites attributes, never that the seed should change.
    assert.deepEqual(root(seeded), root(doc), FROZEN_SEED_MESSAGE);
  });
});

describe('seedEmptyDoc', () => {
  it('seeds two empty replicas identically so they merge into one root', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    expect(seedEmptyDoc(a, 'x')).toBe(true);
    expect(seedEmptyDoc(b, 'x')).toBe(true);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getXmlFragment(BLOCKNOTE_FRAGMENT).length).toBe(1);
    expect(fragmentText(a)).toBe(fragmentText(b));
  });

  it('leaves a doc that already has content untouched', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment(BLOCKNOTE_FRAGMENT);
    fragment.insert(0, [new Y.XmlElement('blockGroup')]);
    const before = Y.encodeStateAsUpdate(doc);
    expect(seedEmptyDoc(doc, 'x')).toBe(false);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it('tags the seed with the given origin so a provider does not echo it', () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    const origin = {};
    seedEmptyDoc(doc, origin);
    expect(origins).toEqual([origin]);
  });
});
