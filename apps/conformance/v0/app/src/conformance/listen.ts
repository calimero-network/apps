/**
 * Listening, for the Events and Presence rows: a subscription opened in one
 * phase and read in a later one, while the other session writes in between.
 *
 * Both read the session's own client the way mero-react's hooks do:
 * `useSubscription` is `events.on('event') + connect() + subscribe()`, and
 * `useEphemeral` is `ephemeral.subscribe()` / `ephemeral.set()`. On a node that
 * is the node's `/sse` and its ephemeral RPC; on an account it is the relay's
 * `/sse` (a request proof, or the pinned relay key) and `presence-intents`.
 */
import { eventually, Mismatch, short, sleep } from './check';

/**
 * Poll `find` until it yields something, or fail with `describe()` evaluated
 * at the deadline, so the failure names what DID arrive by then.
 */
async function until<T>(find: () => T | undefined, describe: () => string, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = find();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Mismatch(`${describe()} after ${timeoutMs} ms`);
    await sleep(500);
  }
}

/** What `useSubscription` reads off the client: mero-js's `SseClient`. */
export interface EventStream {
  on(event: 'event' | 'connect' | 'error', handler: (x: never) => void): void;
  off(event: 'event' | 'connect' | 'error', handler: (x: never) => void): void;
  connect(): Promise<void>;
  subscribe(opts: { contextIds: string[] }): Promise<void>;
  unsubscribe(opts: { contextIds: string[] }): Promise<void>;
}

/** One presence slot, as mero-js delivers it (`EphemeralEntry`). */
export interface PresenceEntry {
  readonly author: string;
  readonly account?: string;
  readonly state?: unknown;
  readonly removed?: boolean;
  readonly ageMs?: number;
}

/** What `useEphemeral` reads off the client: a node's `EphemeralClient`, an account's `RelayPresenceClient`. */
export interface Presence {
  set(contextId: string, state: unknown): Promise<void>;
  subscribe(contextId: string, handler: (entry: PresenceEntry) => void): () => void;
}

export interface Streams {
  readonly events: EventStream;
  readonly presence: Presence;
}

/**
 * True when `marker` appears anywhere in `value`. An execution event carries
 * the app's emitted events with their payloads as byte arrays (the contract's
 * JSON, UTF-8), so a number array is decoded and searched as text too.
 */
export function mentions(value: unknown, marker: string): boolean {
  if (typeof value === 'string') return value.includes(marker);
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((x) => typeof x === 'number' && x >= 0 && x < 256)) {
      try {
        if (new TextDecoder().decode(new Uint8Array(value as number[])).includes(marker)) return true;
      } catch {
        /* not text */
      }
    }
    return value.some((x) => mentions(x, marker));
  }
  if (value && typeof value === 'object') return Object.values(value).some((x) => mentions(x, marker));
  return false;
}

/** Every event for one context, from the moment the subscription is up. */
export class EventLog {
  readonly events: unknown[] = [];
  private close: () => void = () => {};

  /**
   * Subscribe and wait until the stream is connected: `SseClient` sends a
   * subscription only once it holds a session id, so a stream that never
   * connects would otherwise look like a subscription that heard nothing.
   */
  static async open(stream: EventStream, contextId: string): Promise<EventLog> {
    const log = new EventLog();
    // A node's stream is already open (the provider connects it to track being
    // online), and then no `connect` event comes: its session id says so.
    let connected = Boolean((stream as unknown as { sessionId?: string | null }).sessionId);
    let failure: Error | undefined;
    const onEvent = (e: { contextId?: string }) => {
      if (e?.contextId === contextId) log.events.push(e);
    };
    const onConnect = () => {
      connected = true;
    };
    const onError = (e: Error) => {
      failure = e;
    };
    stream.on('event', onEvent as never);
    stream.on('connect', onConnect as never);
    stream.on('error', onError as never);
    log.close = () => {
      stream.off('event', onEvent as never);
      stream.off('connect', onConnect as never);
      stream.off('error', onError as never);
      void stream.unsubscribe({ contextIds: [contextId] }).catch(() => undefined);
    };
    try {
      await stream.connect();
      await stream.subscribe({ contextIds: [contextId] });
      await eventually(
        async () => {
          if (!connected && failure) throw failure;
          return connected;
        },
        Boolean,
        'the event stream connected',
        20_000,
      );
    } catch (e) {
      log.close();
      throw e;
    }
    return log;
  }

  /** Resolves with the first event that mentions `marker`, or fails naming what did arrive. */
  async waitFor(marker: string, what: string, timeoutMs = 30_000): Promise<unknown> {
    return until(
      () => this.events.find((e) => mentions(e, marker)),
      () => `${what}: not heard (${this.events.length} events for the context: ${short(this.events.map((e) => (e as { type?: string }).type), 120)})`,
      timeoutMs,
    );
  }

  stop() {
    this.close();
  }
}

/** Every presence slot seen for one context. */
export class PresenceLog {
  readonly entries: PresenceEntry[] = [];
  private unsubscribe: () => void = () => {};

  static open(presence: Presence, contextId: string): PresenceLog {
    const log = new PresenceLog();
    log.unsubscribe = presence.subscribe(contextId, (entry) => {
      log.entries.push(entry);
    });
    return log;
  }

  /** The first live slot whose state carries `who`. */
  async waitFor(who: string, what: string, timeoutMs = 30_000): Promise<PresenceEntry> {
    return until(
      () => this.entries.find((e) => !e.removed && (e.state as { who?: string } | undefined)?.who === who),
      () => `${what}: not seen (${this.entries.length} entries for the context: ${short(this.entries.map((e) => e.state), 160)})`,
      timeoutMs,
    );
  }

  stop() {
    this.unsubscribe();
  }
}
