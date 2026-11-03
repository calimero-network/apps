// Live updates: an app instance's committed events and its presence.
//
// v1 had one SSE socket per node carrying every subscribed context's
// `StateMutation` batches, and an ephemeral channel per context. On 1.0 each
// app instance has its own event stream (`client.events(app, from)`) and its
// own presence (`publishPresence` / `presenceStream`). The hubs below keep one
// stream per instance however many hooks listen, hand each event to them in
// v1's batch shape (`{ contextId, type: 'StateMutation', data: { events } }`,
// which `lib/rich/events.ts` already reads), and say when a stream (re)opens,
// since nothing replays what happened while it was down.

import type { CalimeroClient, CloudEvent } from '@calimero-network/mero-js';

/** One delivered event, in the shape v1's subscription handlers read. */
export interface SseEventData {
  contextId: string;
  type: 'StateMutation';
  data: { events: Array<{ kind: string; data: unknown }> };
}
export type SubscriptionEventData = SseEventData;
export type EventHandler = (event: SubscriptionEventData) => void;

const RETRY_MS = 2_000;

interface Stream {
  handlers: Set<EventHandler>;
  abort: AbortController;
}

export class EventHub {
  private readonly streams = new Map<string, Stream>();
  private readonly connectListeners = new Set<() => void>();
  private readonly onlineListeners = new Set<(online: boolean) => void>();
  private failing = new Set<string>();

  constructor(private readonly client: CalimeroClient) {}

  /** Calls `handler` for every event `app` commits from now on. */
  subscribe(app: string, handler: EventHandler): () => void {
    let stream = this.streams.get(app);
    if (!stream) {
      stream = { handlers: new Set(), abort: new AbortController() };
      this.streams.set(app, stream);
      void this.run(app, stream);
    }
    stream.handlers.add(handler);
    const s = stream;
    return () => {
      s.handlers.delete(handler);
      if (s.handlers.size === 0) {
        s.abort.abort();
        this.streams.delete(app);
        this.setFailing(app, false);
      }
    };
  }

  /** Fires whenever a stream (re)opens. */
  onConnect(listener: () => void): () => void {
    this.connectListeners.add(listener);
    return () => this.connectListeners.delete(listener);
  }

  onOnline(listener: (online: boolean) => void): () => void {
    this.onlineListeners.add(listener);
    return () => this.onlineListeners.delete(listener);
  }

  get online(): boolean {
    return this.failing.size === 0;
  }

  close(): void {
    for (const s of this.streams.values()) s.abort.abort();
    this.streams.clear();
  }

  private setFailing(app: string, failing: boolean): void {
    const was = this.online;
    if (failing) this.failing.add(app);
    else this.failing.delete(app);
    if (was !== this.online) for (const l of this.onlineListeners) l(this.online);
  }

  private async run(app: string, stream: Stream): Promise<void> {
    const { signal } = stream.abort;
    let from: number | null = null;
    while (!signal.aborted) {
      try {
        if (from === null) {
          // Start after what is already applied: a view answers the index.
          const { index } = await this.client.view(app, 'listManagers', {});
          from = index + 1;
        }
        const events = this.client.events(app, from, signal);
        this.setFailing(app, false);
        for (const l of this.connectListeners) l();
        for await (const event of events as AsyncGenerator<CloudEvent>) {
          const at = Number(event.id);
          if (Number.isFinite(at)) from = at + 1;
          const delivered: SseEventData = {
            contextId: app,
            type: 'StateMutation',
            data: { events: [{ kind: event.kind, data: event.data }] },
          };
          for (const h of [...stream.handlers]) {
            try {
              h(delivered);
            } catch (e) {
              console.warn('[events] handler failed', e);
            }
          }
        }
      } catch (e) {
        if (signal.aborted) return;
        console.warn('[events] stream dropped', app, e);
        this.setFailing(app, true);
      }
      if (signal.aborted) return;
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }
}

// ---------------------------------------------------------------- presence

export interface PresencePeer<T> {
  value: T;
  at: number;
}

interface PresenceChannel {
  peers: Map<string, PresencePeer<unknown>>;
  listeners: Set<() => void>;
  abort: AbortController;
  error: Error | null;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Presence per app instance: who is here and their last slice. An author is
 * `account/device`; this account's own entries are left out, as v1 left this
 * node out.
 */
export class PresenceHub {
  private readonly channels = new Map<string, PresenceChannel>();
  private seq = Date.now();

  constructor(
    private readonly client: CalimeroClient,
    private readonly self: string,
  ) {}

  /** Publishes `value` as this device's slice in `app`; an empty object retracts it. */
  set(app: string, value: object): Promise<void> {
    const empty = Object.keys(value).length === 0;
    this.seq += 1;
    return this.client.publishPresence(app, this.seq, empty ? null : encoder.encode(JSON.stringify(value)));
  }

  watch(app: string, listener: () => void): () => void {
    let ch = this.channels.get(app);
    if (!ch) {
      ch = { peers: new Map(), listeners: new Set(), abort: new AbortController(), error: null };
      this.channels.set(app, ch);
      void this.run(app, ch);
    }
    ch.listeners.add(listener);
    const c = ch;
    return () => {
      c.listeners.delete(listener);
      if (c.listeners.size === 0) {
        c.abort.abort();
        this.channels.delete(app);
      }
    };
  }

  peers(app: string): Map<string, PresencePeer<unknown>> {
    return this.channels.get(app)?.peers ?? new Map();
  }

  error(app: string): Error | null {
    return this.channels.get(app)?.error ?? null;
  }

  private apply(ch: PresenceChannel, raw: unknown): void {
    const e = (raw ?? {}) as { account?: string; device?: string; state?: string | null };
    if (typeof e.account !== 'string' || e.account === this.self) return;
    const author = `${e.account}/${e.device ?? ''}`;
    if (typeof e.state !== 'string') {
      ch.peers.delete(author);
      return;
    }
    try {
      ch.peers.set(author, { value: JSON.parse(decoder.decode(fromHex(e.state))), at: Date.now() });
    } catch {
      ch.peers.delete(author);
    }
  }

  private async run(app: string, ch: PresenceChannel): Promise<void> {
    const { signal } = ch.abort;
    while (!signal.aborted) {
      try {
        for await (const event of this.client.presenceStream(app, signal) as AsyncGenerator<CloudEvent>) {
          if (event.kind === 'snapshot') {
            ch.peers = new Map();
            for (const entry of Array.isArray(event.data) ? event.data : []) this.apply(ch, entry);
          } else {
            this.apply(ch, event.data);
          }
          ch.peers = new Map(ch.peers);
          ch.error = null;
          for (const l of [...ch.listeners]) l();
        }
      } catch (e) {
        if (signal.aborted) return;
        ch.error = e instanceof Error ? e : new Error(String(e));
        for (const l of [...ch.listeners]) l();
      }
      if (signal.aborted) return;
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }
}
