// @vitest-environment jsdom
/**
 * A write is read back once: by the refetch its own event starts, not by one
 * of its own and then another for the event.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withRoutes } from '@calimero-apps/connect/testing';

import { ECHO_WAIT_MS, useIssues } from './useItems';

const FILTERS = { status: '', assignee: '', label: '' };

/** A fake node: views answer nothing, calls succeed, and `emit()` sends one event on the stream. */
function fakeNode() {
  let push: (() => void) | null = null;
  const view = vi.fn(async (_app: string, _method: string) => ({ index: 1, result: [] }));
  const call = vi.fn(async () => ({ index: 2, result: null, events: [] }));
  const froms: unknown[] = [];
  async function* events(_app: string, from: unknown, signal?: AbortSignal) {
    froms.push(from);
    while (!signal?.aborted) {
      await new Promise<void>((resolve) => {
        push = resolve;
      });
      yield { event: 'IssueStatusChanged', id: '1:0', data: {} };
    }
  }
  const client = Object.assign(withRoutes({ view, call }), { events });
  return { client, view, call, froms, emit: () => push?.() };
}

/** Full reads so far: each reads `listIssues` once. */
const reads = (view: ReturnType<typeof fakeNode>['view']) =>
  view.mock.calls.filter((c) => c[1] === 'listIssues').length;

afterEach(() => {
  vi.useRealTimers();
});

describe('useIssues events', () => {
  it('streams from after the log\'s head, not the whole log', async () => {
    const node = fakeNode();
    renderHook(() => useIssues({ client: node.client, appId: 'app-1', filters: FILTERS }));
    await waitFor(() => expect(node.froms).toEqual([2]));
  });
});

describe('useIssues writes', () => {
  it('waits for its own event and reads once after it', async () => {
    const node = fakeNode();
    const { result } = renderHook(() => useIssues({ client: node.client, appId: 'app-1', filters: FILTERS }));
    await waitFor(() => expect(reads(node.view)).toBe(1));

    let settled = false;
    let write!: Promise<unknown>;
    act(() => {
      write = result.current.setStatus('issue-1', 'done').then(() => {
        settled = true;
      });
    });
    await waitFor(() => expect(node.call).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
    expect(reads(node.view)).toBe(1);

    node.emit();
    await act(() => write);
    expect(settled).toBe(true);
    expect(reads(node.view)).toBe(2);
  });

  it('refetches by itself when no event comes', async () => {
    const node = fakeNode();
    const { result } = renderHook(() => useIssues({ client: node.client, appId: 'app-1', filters: FILTERS }));
    await waitFor(() => expect(reads(node.view)).toBe(1));

    vi.useFakeTimers();
    let write!: Promise<unknown>;
    act(() => {
      write = result.current.setStatus('issue-1', 'done');
    });
    await vi.advanceTimersByTimeAsync(ECHO_WAIT_MS);
    vi.useRealTimers();
    await act(() => write);
    expect(reads(node.view)).toBe(2);
  });
});
