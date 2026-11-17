import { describe, expect, it, vi } from 'vitest';
import type { CalimeroClient, NodeEvent } from '@calimero-network/mero-js';
import { EventHub, PresenceHub, type SubscriptionEventData } from '../live';
import { withRoutes } from '@calimero-apps/connect/testing';

/** A stream that yields `events`, then waits until aborted. */
async function* stream(events: NodeEvent[], signal?: AbortSignal): AsyncGenerator<NodeEvent> {
  for (const e of events) yield e;
  await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
}

const hex = (value: unknown) =>
  Array.from(new TextEncoder().encode(JSON.stringify(value)), (b) => b.toString(16).padStart(2, '0')).join('');

describe('EventHub', () => {
  it('starts after the applied index, hands each event over in the batch shape, and says it connected', async () => {
    const events = vi.fn((_app: string, _from: number, signal?: AbortSignal) =>
      stream([{ id: '8', kind: 'TextChanged', data: { doc: 'd', block: 'b' } }], signal),
    );
    const client = withRoutes({
      view: vi.fn(async () => ({ index: 7, result: [] })),
      events,
    }) as unknown as CalimeroClient;
    const hub = new EventHub(client);
    const got: SubscriptionEventData[] = [];
    const connected = vi.fn();
    hub.onConnect(connected);
    const off = hub.subscribe('app-1', (e) => got.push(e));
    await vi.waitFor(() => expect(got).toHaveLength(1));
    expect(events).toHaveBeenCalledWith('app-1', 8, expect.any(AbortSignal));
    expect(got[0]).toEqual({
      contextId: 'app-1',
      type: 'StateMutation',
      data: { events: [{ kind: 'TextChanged', data: { doc: 'd', block: 'b' } }] },
    });
    expect(connected).toHaveBeenCalledTimes(1);
    off();
  });

  it('reopens after the last `index:seq` it saw, not from where it started', async () => {
    let opened = 0;
    const events = vi.fn(async function* (_app: string, _from: number, signal?: AbortSignal) {
      opened += 1;
      if (opened === 1) {
        yield { id: '12:0', kind: 'TextChanged', data: {} };
        throw new Error('dropped');
      }
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
    });
    const client = withRoutes({
      view: vi.fn(async () => ({ index: 7, result: [] })),
      events,
    }) as unknown as CalimeroClient;
    vi.useFakeTimers();
    try {
      const hub = new EventHub(client);
      const off = hub.subscribe('app-1', () => {});
      await vi.advanceTimersByTimeAsync(2_500);
      expect(events.mock.calls.map((c) => c[1])).toEqual([8, 13]);
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks the events of a tracked call as its own, holding those that beat its answer', async () => {
    // A live stream: each pushed event is yielded as it comes.
    const waiting: Array<(e: NodeEvent) => void> = [];
    const pending: NodeEvent[] = [];
    const push = (e: NodeEvent) => {
      const take = waiting.shift();
      if (take) take(e);
      else pending.push(e);
    };
    const next = () =>
      pending.length ? Promise.resolve(pending.shift()!) : new Promise<NodeEvent>((resolve) => waiting.push(resolve));
    const events = vi.fn(async function* (_app: string, _from: number, signal?: AbortSignal) {
      while (!signal?.aborted) yield await next();
    });
    const client = withRoutes({
      view: vi.fn(async () => ({ index: 0, result: [] })),
      events,
    }) as unknown as CalimeroClient;
    const hub = new EventHub(client);
    const got: SubscriptionEventData[] = [];
    const off = hub.subscribe('app-1', (e) => got.push(e));
    await vi.waitFor(() => expect(events).toHaveBeenCalled());

    let answer: (v: { index: number }) => void = () => {};
    const call = hub.track('app-1', new Promise<{ index: number }>((resolve) => (answer = resolve)));
    push({ id: '5:0', kind: 'TextChanged', data: {} }); // the call's own, before its answer
    push({ id: '6:0', kind: 'TextChanged', data: {} }); // a peer's
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toHaveLength(0);
    answer({ index: 5 });
    await call;
    expect(got.map((e) => e.own ?? false)).toEqual([true, false]);
    push({ id: '7:0', kind: 'TextChanged', data: {} });
    await vi.waitFor(() => expect(got).toHaveLength(3));
    expect(got[2]!.own).toBeUndefined();
    off();
  });

  it('keeps one stream per instance however many listen', async () => {
    const events = vi.fn((_app: string, _from: number, signal?: AbortSignal) => stream([], signal));
    const client = withRoutes({
      view: vi.fn(async () => ({ index: 0, result: [] })),
      events,
    }) as unknown as CalimeroClient;
    const hub = new EventHub(client);
    const a = hub.subscribe('app-1', () => {});
    const b = hub.subscribe('app-1', () => {});
    await vi.waitFor(() => expect(events).toHaveBeenCalledTimes(1));
    a();
    b();
  });
});

describe('PresenceHub', () => {
  it('reads the snapshot and changes, leaving this account out', async () => {
    const presenceStream = vi.fn((_app: string, signal?: AbortSignal) =>
      stream(
        [
          {
            id: '1',
            kind: 'snapshot',
            data: [
              { account: 'me', device: 'd0', state: hex({ docId: 'x' }) },
              { account: 'bob', device: 'd1', state: hex({ docId: 'x' }) },
            ],
          },
          { id: '2', kind: 'presence', data: { account: 'cy', device: 'd2', state: hex({ docId: 'y' }) } },
          { id: '3', kind: 'presence', data: { account: 'bob', device: 'd1', state: null } },
        ],
        signal,
      ),
    );
    const client = withRoutes({
      presenceStream,
      publishPresence: vi.fn(async () => undefined),
    }) as unknown as CalimeroClient;
    const hub = new PresenceHub(client, 'me');
    const changed = vi.fn();
    const off = hub.watch('app-1', changed);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(3));
    expect([...hub.peers('app-1')].map(([author, p]) => [author, p.value])).toEqual([['cy/d2', { docId: 'y' }]]);
    off();
  });

  it('publishes a slice as JSON bytes with a rising seq, and an empty slice as a retraction', async () => {
    const publishPresence = vi.fn(async () => undefined);
    const hub = new PresenceHub(withRoutes({ publishPresence }) as unknown as CalimeroClient, 'me');
    await hub.set('app-1', { a: 'me' });
    await hub.set('app-1', {});
    const [first, second] = publishPresence.mock.calls as unknown as [string, number, Uint8Array | null][];
    expect(new TextDecoder().decode(first[2]!)).toBe('{"a":"me"}');
    expect(second[1]).toBeGreaterThan(first[1]);
    expect(second[2]).toBeNull();
  });
});
