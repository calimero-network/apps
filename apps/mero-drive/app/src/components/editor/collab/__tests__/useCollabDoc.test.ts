// Pins the hook's seed wiring: an empty doc is seeded before it is exposed,
// the seed is not echoed as an edit, and the first local flush writes it.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { useCollabDoc } from '../useCollabDoc';
import { BLOCKNOTE_FRAGMENT, EMPTY_DOC_SEED } from '../blocknote-seed';

let log: Uint8Array[] = [];
const appendUpdate = vi.fn(async (_id: string, u: Uint8Array) => {
  log.push(u.slice());
});
const getUpdates = vi.fn(async () => log.map((u) => u.slice()));

vi.mock('@/hooks/useDocs', () => ({
  useDocs: () => ({ contextId: 'ctx-1', appendUpdate, getUpdates }),
}));
vi.mock('@/hooks/useContextEvents', () => ({
  useContextEvents: () => {},
}));

beforeEach(() => {
  log = [];
  appendUpdate.mockClear();
  getUpdates.mockClear();
});

async function hydrate() {
  const view = renderHook(() => useCollabDoc('folder-1', 'doc-1'));
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  return view;
}

function paragraphOf(doc: Y.Doc): Y.XmlElement {
  const group = doc.getXmlFragment(BLOCKNOTE_FRAGMENT).get(0) as Y.XmlElement;
  const container = group.get(0) as Y.XmlElement;
  return container.get(0) as Y.XmlElement;
}

describe('useCollabDoc seeding', () => {
  it('seeds an empty doc before exposing it, without writing', async () => {
    const view = await hydrate();
    const doc = view.result.current.ydoc!;
    expect(doc.getXmlFragment(BLOCKNOTE_FRAGMENT).length).toBe(1);
    expect(appendUpdate).not.toHaveBeenCalled();
    view.unmount();
  });

  it('writes the seed ahead of the first local edit', async () => {
    const view = await hydrate();
    const { ydoc, provider } = view.result.current;
    paragraphOf(ydoc!).insert(0, [new Y.XmlText('hi')]);
    await provider!.flush();
    expect(log).toHaveLength(2);
    expect(log[0]).toEqual(EMPTY_DOC_SEED);
    view.unmount();
  });

  it('does not seed or write the seed for a doc that already has content', async () => {
    const existing = new Y.Doc();
    existing
      .getXmlFragment(BLOCKNOTE_FRAGMENT)
      .insert(0, [new Y.XmlElement('blockGroup')]);
    log = [Y.encodeStateAsUpdate(existing)];

    const view = await hydrate();
    const { ydoc, provider } = view.result.current;
    expect(ydoc!.getXmlFragment(BLOCKNOTE_FRAGMENT).length).toBe(1);
    ydoc!.getXmlFragment(BLOCKNOTE_FRAGMENT).insert(1, [new Y.XmlElement('p')]);
    await provider!.flush();
    expect(log).toHaveLength(2);
    expect(log[1]).not.toEqual(EMPTY_DOC_SEED);
    view.unmount();
  });
});
