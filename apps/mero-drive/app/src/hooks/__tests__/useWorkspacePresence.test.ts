// `useEphemeral` is faked so a test can set the peer map and each author's age,
// and `mero.ephemeral.set` is faked so a test can read what was published.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  usePublishWorkspacePresence,
  useWorkspacePresence,
} from '../useWorkspacePresence';

const CTX = 'registry-ctx';
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const MALLORY = 'm'.repeat(64);
const MEMBERS = [ALICE, BOB];

const set = vi.fn(async () => {});
let peers = new Map<string, unknown>();
let ages = new Map<string, number>();

vi.mock('@calimero-network/mero-react', () => ({
  useEphemeral: () => ({
    peers,
    ageOf: (author: string) => ages.get(author),
  }),
  useMero: () => ({ mero: { ephemeral: { set } } }),
}));

function present(members: readonly string[] = MEMBERS) {
  return renderHook(() => useWorkspacePresence(CTX, ALICE, members));
}

beforeEach(() => {
  vi.useFakeTimers();
  set.mockClear();
  peers = new Map();
  ages = new Map();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useWorkspacePresence', () => {
  it('counts this node as present without any peer', () => {
    expect(present().result.current).toEqual(new Set([ALICE]));
  });

  it('reports a peer by the account its slice names, not by its device', () => {
    peers = new Map([['bob-node', { a: BOB, n: 0 }]]);
    ages = new Map([['bob-node', 0]]);
    expect(present().result.current).toEqual(new Set([ALICE, BOB]));
  });

  it('collapses two devices of one account into one entry', () => {
    peers = new Map([
      ['bob-laptop', { a: BOB, n: 3 }],
      ['bob-phone', { a: BOB, n: 7 }],
    ]);
    ages = new Map([
      ['bob-laptop', 0],
      ['bob-phone', 0],
    ]);
    const { result } = present();
    expect(result.current).toEqual(new Set([ALICE, BOB]));
  });

  it('ignores a claim for an account that is not a member', () => {
    peers = new Map([['mallory-node', { a: MALLORY, n: 0 }]]);
    ages = new Map([['mallory-node', 0]]);
    expect(present().result.current).toEqual(new Set([ALICE]));
  });

  it('ignores malformed slices', () => {
    const slices: unknown[] = [null, {}, { a: 42 }, { a: '' }, 'bob', [BOB]];
    slices.forEach((slice, i) => {
      peers.set(`bad-${i}`, slice);
      ages.set(`bad-${i}`, 0);
    });
    expect(present().result.current).toEqual(new Set([ALICE]));
  });

  it('drops a peer the node swept', () => {
    peers = new Map([['bob-node', { a: BOB, n: 0 }]]);
    ages = new Map([['bob-node', 0]]);
    const { result, rerender } = present();
    expect(result.current.has(BOB)).toBe(true);

    peers = new Map();
    rerender();
    expect(result.current.has(BOB)).toBe(false);
  });

  it('ages out a peer whose slice stopped changing', () => {
    // A closed tab's node keeps replaying its last slice, so only age tells.
    peers = new Map([['bob-node', { a: BOB, n: 0 }]]);
    ages = new Map([['bob-node', 0]]);
    const { result } = present();
    expect(result.current.has(BOB)).toBe(true);

    ages.set('bob-node', 30_000);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.has(BOB)).toBe(false);
  });
});

describe('usePublishWorkspacePresence', () => {
  it('publishes the account and changes the slice on every beat', () => {
    renderHook(() => usePublishWorkspacePresence(CTX, ALICE));
    expect(set).toHaveBeenLastCalledWith(CTX, { a: ALICE, n: 0 });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(set).toHaveBeenLastCalledWith(CTX, { a: ALICE, n: 1 });
  });

  it('publishes nothing before the account or the context resolves', () => {
    renderHook(() => usePublishWorkspacePresence(CTX, null));
    renderHook(() => usePublishWorkspacePresence(null, ALICE));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(set).not.toHaveBeenCalled();
  });

  it('leaves on unmount and stops beating', () => {
    const { unmount } = renderHook(() =>
      usePublishWorkspacePresence(CTX, ALICE),
    );
    unmount();
    expect(set).toHaveBeenLastCalledWith(CTX, {});
    set.mockClear();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(set).not.toHaveBeenCalled();
  });
});
