// @vitest-environment jsdom
import { act, useCallback, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearNamespaceJustJoined,
  isNamespaceJustJoined,
  JOIN_SYNC_POLL_MS,
  markNamespaceJustJoined,
} from '@calimero-apps/cloud';
import { useLobbyJoinSync, type LobbyReadFor } from './useLobbyJoinSync';

// ── A lobby this session just joined ────────────────────────────────────────
//
// Right after the join the node may not have synced the lobby yet, so the
// read of its match list fails. Nothing read the lobby again after that, so
// the invitation dialog waited out its watchdog; the lobby is now re-read
// until a read succeeds, and a read that succeeds settles the gate even when
// the lobby has no matches yet.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NS = 'ns-1';
const CTX = 'ctx-1';

const node = { matches: [] as string[], synced: true };
const reads = vi.fn();

// Mirrors the match page: one read on mount, which records the lobby it was for.
function Harness() {
  const [matches, setMatches] = useState<string[]>([]);
  const [readFor, setReadFor] = useState<LobbyReadFor | null>(null);
  const read = useCallback(async () => {
    reads();
    if (!node.synced) return; // the page swallows the failed read
    setMatches([...node.matches]);
    setReadFor({ namespaceId: NS, contextId: CTX });
  }, []);
  useEffect(() => {
    void read();
  }, [read]);
  useLobbyJoinSync({
    namespaceId: NS,
    contextId: CTX,
    readFor,
    reread: read,
  });
  return null;
}

let root: Root;
const renderHarness = () =>
  act(() => {
    root = createRoot(document.createElement('div'));
    root.render(<Harness />);
  });
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  node.matches = [];
  node.synced = true;
  reads.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  clearNamespaceJustJoined(NS);
  vi.useRealTimers();
});

describe('useLobbyJoinSync right after joining the lobby', () => {
  it('re-reads a lobby that has not synced yet until a read succeeds', async () => {
    markNamespaceJustJoined(NS);
    node.synced = false;
    await renderHarness();
    await advance(100);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(isNamespaceJustJoined(NS)).toBe(true);

    await advance(JOIN_SYNC_POLL_MS);
    expect(reads).toHaveBeenCalledTimes(2);
    expect(isNamespaceJustJoined(NS)).toBe(true);

    node.synced = true;
    await advance(JOIN_SYNC_POLL_MS);
    expect(isNamespaceJustJoined(NS)).toBe(false);

    // Settled: the polling stops.
    const settledAt = reads.mock.calls.length;
    await advance(JOIN_SYNC_POLL_MS * 3);
    expect(reads).toHaveBeenCalledTimes(settledAt);
  });

  it('settles on a synced lobby with no matches yet', async () => {
    markNamespaceJustJoined(NS);
    await renderHarness();
    await advance(100);
    expect(isNamespaceJustJoined(NS)).toBe(false);
  });

  it('does not poll a lobby that was not just joined', async () => {
    await renderHarness();
    await advance(JOIN_SYNC_POLL_MS * 3);
    expect(reads).toHaveBeenCalledTimes(1);
  });
});
