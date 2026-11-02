import { describe, expect, it, vi } from 'vitest';
import type { CalimeroClient, CloudEvent } from '@calimero-network/mero-js';
import { EventHub, PresenceHub, type SubscriptionEventData } from '../live';

/** A stream that yields `events`, then waits until aborted. */
async function* stream(events: CloudEvent[], signal?: AbortSignal): AsyncGenerator<CloudEvent> {
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
    const client = { view: vi.fn(async () => ({ index: 7, result: [] })), events } as unknown as CalimeroClient;
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

  it('keeps one stream per instance however many listen', async () => {
    const events = vi.fn((_app: string, _from: number, signal?: AbortSignal) => stream([], signal));
    const client = { view: vi.fn(async () => ({ index: 0, result: [] })), events } as unknown as CalimeroClient;
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
    const client = { presenceStream, publishPresence: vi.fn(async () => undefined) } as unknown as CalimeroClient;
    const hub = new PresenceHub(client, 'me');
    const changed = vi.fn();
    const off = hub.watch('app-1', changed);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(3));
    expect([...hub.peers('app-1')].map(([author, p]) => [author, p.value])).toEqual([['cy/d2', { docId: 'y' }]]);
    off();
  });

  it('publishes a slice as JSON bytes with a rising seq, and an empty slice as a retraction', async () => {
    const publishPresence = vi.fn(async () => undefined);
    const hub = new PresenceHub({ publishPresence } as unknown as CalimeroClient, 'me');
    await hub.set('app-1', { a: 'me' });
    await hub.set('app-1', {});
    const [first, second] = publishPresence.mock.calls as unknown as [string, number, Uint8Array | null][];
    expect(new TextDecoder().decode(first[2]!)).toBe('{"a":"me"}');
    expect(second[1]).toBeGreaterThan(first[1]);
    expect(second[2]).toBeNull();
  });
});
