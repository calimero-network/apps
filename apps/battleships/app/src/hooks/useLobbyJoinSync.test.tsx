// @vitest-environment jsdom
import { act, useCallback, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearNamespaceJustJoined,
  isNamespaceJustJoined,
  JOIN_SYNC_POLL_MS,
  markNamespaceJustJoined,
} from '@calimero-network/mero-react';
import { useLobbyJoinSync, type LobbyReadFor } from './useLobbyJoinSync';

// ── A lobby this session just joined ────────────────────────────────────────
//
// Right after the join the node may not have synced the lobby yet, so the
// first read of its match list comes back empty. That is not the lobby's real
// answer, so it may not settle the join-sync gate (which closes the invitation
// dialog onto an empty lobby with nothing reading again); the lobby is re-read
// until the matches land.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NS = 'ns-1';
const CTX = 'ctx-1';

const node = { matches: [] as string[] };
const reads = vi.fn();

// Mirrors the match page: one read on mount, which records the lobby it was for.
function Harness() {
  const [matches, setMatches] = useState<string[]>([]);
  const [readFor, setReadFor] = useState<LobbyReadFor | null>(null);
  const read = useCallback(async () => {
    reads();
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
    matchCount: matches.length,
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
  reads.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  clearNamespaceJustJoined(NS);
  vi.useRealTimers();
});

describe('useLobbyJoinSync right after joining the lobby', () => {
  it('does not settle on an empty first read, and re-reads until a match arrives', async () => {
    markNamespaceJustJoined(NS);
    await renderHarness();
    await advance(100);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(isNamespaceJustJoined(NS)).toBe(true);

    await advance(JOIN_SYNC_POLL_MS);
    expect(reads).toHaveBeenCalledTimes(2);
    expect(isNamespaceJustJoined(NS)).toBe(true);

    node.matches = ['match-1'];
    await advance(JOIN_SYNC_POLL_MS);
    expect(isNamespaceJustJoined(NS)).toBe(false);

    // Settled: the polling stops.
    const settledAt = reads.mock.calls.length;
    await advance(JOIN_SYNC_POLL_MS * 3);
    expect(reads).toHaveBeenCalledTimes(settledAt);
  });

  it('keeps waiting past the base window while the lobby is still empty', async () => {
    markNamespaceJustJoined(NS);
    await renderHarness();
    await advance(60_000);
    expect(isNamespaceJustJoined(NS)).toBe(true);

    await advance(65_000);
    expect(isNamespaceJustJoined(NS)).toBe(false);
  });

  it('takes an empty lobby at its word when it was not just joined', async () => {
    await renderHarness();
    await advance(100);
    expect(isNamespaceJustJoined(NS)).toBe(false);

    await advance(JOIN_SYNC_POLL_MS * 3);
    expect(reads).toHaveBeenCalledTimes(1);
  });
});
