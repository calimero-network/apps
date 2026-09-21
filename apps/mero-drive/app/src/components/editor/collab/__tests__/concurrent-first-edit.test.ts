// Two headless BlockNote editors, two providers, one shared log: both replicas
// make their first edit before seeing the other's, which is the case that
// produced two roots and lost one writer's text.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { BlockNoteEditor } from '@blocknote/core';
import { schema } from '../../blocknote/schema';
import { blocksToPlainText } from '../../blocknote/content';
import { CalimeroYjsProvider } from '../CalimeroYjsProvider';
import { BLOCKNOTE_FRAGMENT, seedEmptyDoc } from '../blocknote-seed';

const fastOpts = { flushDebounceMs: 5, retryBackoffMs: 1, maxFlushRetries: 1 };

// The docs WASM stands in as one add-only, content-addressed set of blobs.
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

// A fresh reader of the log: apply every blob, then seed like useCollabDoc
// does. The seed is never in the log, so blobs stay pending until it lands.
function foldLog(log: Map<string, Uint8Array>): Y.Doc {
  const doc = new Y.Doc();
  for (const u of log.values()) Y.applyUpdate(doc, u);
  seedEmptyDoc(doc, 'reader');
  return doc;
}

async function openReplica(
  transport: ReturnType<typeof sharedLog>['transport'],
  name: string,
) {
  const doc = new Y.Doc();
  const provider = new CalimeroYjsProvider(doc, transport, fastOpts);
  // Mirrors useCollabDoc: hydrate from the log, then seed an empty doc.
  await provider.pullRemote();
  seedEmptyDoc(doc, provider);
  const editor = BlockNoteEditor.create({
    schema,
    collaboration: {
      fragment: doc.getXmlFragment(BLOCKNOTE_FRAGMENT),
      user: { name, color: '#000000' },
      provider: { awareness: new Awareness(doc) },
    },
  });
  editor.mount(document.createElement('div'));
  return { doc, provider, editor };
}

function typeAtStart(editor: BlockNoteEditor<any, any, any>, text: string) {
  editor.setTextCursorPosition(editor.document[0], 'start');
  editor.insertInlineContent(text);
}

const text = (editor: BlockNoteEditor<any, any, any>) =>
  blocksToPlainText(editor.document);

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('concurrent first edits on an empty doc', () => {
  it('both writers survive in both editors and in the folded log', async () => {
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
    // dropped a root deletes it from the log for everyone.
    typeAtStart(alice.editor, 'more ');
    await alice.provider.flush();
    const folded = foldLog(log).getXmlFragment(BLOCKNOTE_FRAGMENT).toString();
    expect(folded).toContain('BBB-from-bob');
    expect(folded).toContain('AAA-from-alice');

    alice.editor.unmount();
    bob.editor.unmount();
  });
});

describe('seedEmptyDoc', () => {
  it('is byte-identical across replicas so their seeds merge into one root', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    expect(seedEmptyDoc(a, 'x')).toBe(true);
    expect(seedEmptyDoc(b, 'x')).toBe(true);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getXmlFragment(BLOCKNOTE_FRAGMENT).length).toBe(1);
    expect(a.getXmlFragment(BLOCKNOTE_FRAGMENT).toString()).toBe(
      b.getXmlFragment(BLOCKNOTE_FRAGMENT).toString(),
    );
  });

  it('matches the structure y-prosemirror writes for a fresh BlockNote doc', () => {
    const doc = new Y.Doc();
    const editor = BlockNoteEditor.create({
      schema,
      collaboration: {
        fragment: doc.getXmlFragment(BLOCKNOTE_FRAGMENT),
        user: { name: 'x', color: '#000000' },
        provider: { awareness: new Awareness(doc) },
      },
    });
    editor.mount(document.createElement('div'));
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
    expect(root(seeded)).toEqual(root(doc));
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
