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

import { presenceState, type CalimeroClient, type NodeEvent } from '@calimero-network/mero-js';

/** One delivered event, in the shape v1's subscription handlers read. */
export interface SseEventData {
  contextId: string;
  type: 'StateMutation';
  data: { events: Array<{ kind: string; data: unknown }> };
  /**
   * Set when a call this tab made through {@link EventHub.track} committed the
   * event: what it changed is already in the call's answer, so an editor that
   * read it from there need not read it again.
   */
  own?: true;
}
export type SubscriptionEventData = SseEventData;
export type EventHandler = (event: SubscriptionEventData) => void;

const RETRY_MS = 2_000;
const OWN_KEPT = 256; // the latest own log indexes remembered per instance

/** The log index an event id names: the node sends `index:seq`. */
export function eventIndex(id: string): number | null {
  const index = Number.parseInt(id, 10);
  return Number.isFinite(index) ? index : null;
}

interface Stream {
  handlers: Set<EventHandler>;
  abort: AbortController;
}

interface Own {
  /** This tab's calls still waiting for their answer. */
  inFlight: number;
  /** The log indexes those calls committed at. */
  indexes: Set<number>;
  /** Events that arrived while a call was in flight, held until it answers. */
  held: Array<{ index: number | null; event: SseEventData }>;
}

export class EventHub {
  private readonly streams = new Map<string, Stream>();
  private readonly connectListeners = new Set<() => void>();
  private readonly onlineListeners = new Set<(online: boolean) => void>();
  private readonly own = new Map<string, Own>();
  private failing = new Set<string>();

  constructor(private readonly client: CalimeroClient) {}

  private ownOf(app: string): Own {
    let o = this.own.get(app);
    if (!o) {
      o = { inFlight: 0, indexes: new Set(), held: [] };
      this.own.set(app, o);
    }
    return o;
  }

  /**
   * Marks the events `call` commits as this tab's own (`own`). An event that
   * arrives before the call answers is held until it does, so it is known
   * for whose it is.
   */
  async track<T extends { index?: number }>(app: string, call: Promise<T>): Promise<T> {
    const o = this.ownOf(app);
    o.inFlight += 1;
    try {
      const answer = await call;
      if (typeof answer?.index === 'number') {
        o.indexes.add(answer.index);
        if (o.indexes.size > OWN_KEPT) o.indexes.delete(o.indexes.values().next().value as number);
      }
      return answer;
    } finally {
      o.inFlight -= 1;
      if (o.inFlight === 0) {
        const held = o.held;
        o.held = [];
        for (const { index, event } of held) this.dispatch(app, index, event);
      }
    }
  }

  private deliver(app: string, index: number | null, event: SseEventData): void {
    const o = this.own.get(app);
    if (o && o.inFlight > 0) o.held.push({ index, event });
    else this.dispatch(app, index, event);
  }

  private dispatch(app: string, index: number | null, event: SseEventData): void {
    const stream = this.streams.get(app);
    if (!stream) return;
    const own = index !== null && this.own.get(app)?.indexes.has(index);
    const delivered: SseEventData = own ? { ...event, own: true } : event;
    for (const h of [...stream.handlers]) {
      try {
        h(delivered);
      } catch (e) {
        console.warn('[events] handler failed', e);
      }
    }
  }

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
        const o = this.own.get(app);
        if (o && o.inFlight === 0) this.own.delete(app);
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
          const { index } = await this.client.apps.view({ app, method: 'listManagers', args: {} });
          from = index + 1;
        }
        const events = this.client.events(app, from, signal);
        this.setFailing(app, false);
        for (const l of this.connectListeners) l();
        for await (const event of events as AsyncGenerator<NodeEvent>) {
          // `index:seq`: a reopened stream starts after the last index seen,
          // not again from where this one started.
          const at = eventIndex(event.id);
          if (at !== null) from = at + 1;
          this.deliver(app, at, {
            contextId: app,
            type: 'StateMutation',
            data: { events: [{ kind: event.kind, data: event.data }] },
          });
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
  async set(app: string, value: object): Promise<void> {
    const empty = Object.keys(value).length === 0;
    this.seq += 1;
    const state = presenceState(empty ? null : encoder.encode(JSON.stringify(value)));
    // `null` retracts.
    await this.client.apps.presencePublish({ app, seq: this.seq, state });
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
        for await (const event of this.client.presenceStream(app, signal) as AsyncGenerator<NodeEvent>) {
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
