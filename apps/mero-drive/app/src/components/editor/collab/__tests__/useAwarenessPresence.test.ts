// The awareness <-> ephemeral bridge, driven with a real `Awareness` and a
// faked `useEphemeral` so a test can set the peer map and read what was sent.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';
import {
  useAwarenessPresence,
  type PresenceSlice,
} from '../useAwarenessPresence';

const CTX = 'ctx-1';
const DOC = 'doc-1';

const setPresence = vi.fn();
const directSet = vi.fn(async () => {});
const useEphemeral = vi.fn();
let peers = new Map<string, unknown>();

vi.mock('@calimero-network/mero-react', () => ({
  useEphemeral: (...args: unknown[]) => {
    useEphemeral(...args);
    return { peers, setPresence, ageOf: () => undefined, error: null };
  },
  useMero: () => ({ mero: { ephemeral: { set: directSet } } }),
}));

const awarenesses: Awareness[] = [];

function newAwareness(clientId?: number): Awareness {
  const doc = new Y.Doc();
  if (clientId !== undefined) doc.clientID = clientId;
  const aw = new Awareness(doc);
  awarenesses.push(aw);
  return aw;
}

// A slice as another browser publishes it.
function peerSlice(
  name: string,
  opts: { clientId?: number; docId?: string } = {},
): { slice: PresenceSlice; clientId: number } {
  const aw = newAwareness(opts.clientId);
  aw.setLocalStateField('user', { name, color: '#3b82f6' });
  return {
    slice: {
      d: opts.docId ?? DOC,
      u: Array.from(encodeAwarenessUpdate(aw, [aw.clientID])),
    },
    clientId: aw.clientID,
  };
}

function mount(awareness: Awareness | null = newAwareness()) {
  const view = renderHook(() => useAwarenessPresence(CTX, DOC, awareness));
  return { awareness: awareness!, view };
}

beforeEach(() => {
  setPresence.mockClear();
  directSet.mockClear();
  useEphemeral.mockClear();
  peers = new Map();
  awarenesses.splice(0).forEach((aw) => aw.destroy());
});

describe('useAwarenessPresence', () => {
  it('publishes throttled on the docs context, once on mount', () => {
    const { awareness } = mount();
    expect(useEphemeral).toHaveBeenCalledWith(CTX, { throttleMs: 200 });
    expect(setPresence).toHaveBeenCalledTimes(1);
    const sent = setPresence.mock.calls[0][0] as PresenceSlice;
    expect(sent.d).toBe(DOC);
    expect(sent.u).toEqual(
      Array.from(encodeAwarenessUpdate(awareness, [awareness.clientID])),
    );
  });

  it('publishes again when the local cursor moves', () => {
    const { awareness } = mount();
    setPresence.mockClear();
    awareness.setLocalStateField('cursor', { anchor: 1, head: 2 });
    expect(setPresence).toHaveBeenCalledTimes(1);
  });

  it('applies a peer slice so their cursor appears, without republishing', () => {
    const bob = peerSlice('bob');
    peers = new Map([['bob-author', bob.slice]]);
    const { awareness } = mount();
    expect(awareness.getStates().get(bob.clientId)?.user).toEqual({
      name: 'bob',
      color: '#3b82f6',
    });
    expect(setPresence).toHaveBeenCalledTimes(1);
  });

  it('withdraws a cursor when the node sweeps its author', () => {
    const bob = peerSlice('bob');
    peers = new Map([['bob-author', bob.slice]]);
    const { awareness, view } = mount();
    peers = new Map();
    view.rerender();
    expect(awareness.getStates().has(bob.clientId)).toBe(false);
  });

  it('withdraws a cursor when its author leaves this doc', () => {
    const bob = peerSlice('bob');
    peers = new Map([['bob-author', bob.slice]]);
    const { awareness, view } = mount();
    peers = new Map([['bob-author', { d: '', u: [] }]]);
    view.rerender();
    expect(awareness.getStates().has(bob.clientId)).toBe(false);
  });

  it('replaces a cursor when its author reopens the doc under a new client', () => {
    const first = peerSlice('bob');
    peers = new Map([['bob-author', first.slice]]);
    const { awareness, view } = mount();
    const second = peerSlice('bob');
    peers = new Map([['bob-author', second.slice]]);
    view.rerender();
    expect(awareness.getStates().has(first.clientId)).toBe(false);
    expect(awareness.getStates().has(second.clientId)).toBe(true);
  });

  it('ignores a peer on another doc of the same folder', () => {
    const carol = peerSlice('carol', { docId: 'doc-2' });
    peers = new Map([['carol-author', carol.slice]]);
    const { awareness } = mount();
    expect(awareness.getStates().has(carol.clientId)).toBe(false);
  });

  it('ignores a slice carrying our own client id', () => {
    const awareness = newAwareness();
    awareness.setLocalStateField('user', { name: 'me', color: '#3b82f6' });
    const impostor = newAwareness(awareness.clientID);
    // A higher clock than ours, so applying it would overwrite our own state.
    for (let i = 0; i < 5; i++) impostor.setLocalStateField('n', i);
    impostor.setLocalStateField('user', { name: 'impostor', color: '#000' });
    peers = new Map([
      [
        'someone',
        {
          d: DOC,
          u: Array.from(encodeAwarenessUpdate(impostor, [impostor.clientID])),
        },
      ],
    ]);
    mount(awareness);
    expect(awareness.getLocalState()?.user).toEqual({
      name: 'me',
      color: '#3b82f6',
    });
    expect(setPresence).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed slices', () => {
    const two = newAwareness();
    two.setLocalStateField('user', { name: 'x', color: '#000' });
    const other = peerSlice('y');
    applyAwarenessUpdate(two, new Uint8Array(other.slice.u), 'test');
    const twoClients = encodeAwarenessUpdate(two, [
      two.clientID,
      other.clientId,
    ]);
    peers = new Map<string, unknown>([
      ['null', null],
      ['no-bytes', { d: DOC }],
      ['not-bytes', { d: DOC, u: 'abc' }],
      ['truncated', { d: DOC, u: [1] }],
      ['bad-json', { d: DOC, u: [1, 7, 1, 1, 0x7b] }],
      ['two-clients', { d: DOC, u: Array.from(twoClients) }],
    ]);
    const { awareness } = mount();
    expect([...awareness.getStates().keys()]).toEqual([awareness.clientID]);
  });

  it('withdraws our cursor from peers on unmount', () => {
    const { view } = mount();
    view.unmount();
    expect(directSet).toHaveBeenCalledWith(CTX, { d: '', u: [] });
  });

  it('is inert without an awareness instance', () => {
    mount(null);
    expect(setPresence).not.toHaveBeenCalled();
  });
});
