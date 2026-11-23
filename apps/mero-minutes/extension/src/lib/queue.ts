/**
 * Transcript segments on their way to the workspace. Each gets the meeting's
 * next number when it is queued; batches of at most 100 go out oldest first.
 * `appendSegments` skips numbers it already holds, so a batch whose answer was
 * lost is simply sent again. The queue is saved after every change, so a
 * restarted service worker carries on where it stopped.
 */
export type Speaker = "you" | "others";

export interface QueuedSegment {
  seq: number;
  startMs: number;
  endMs: number;
  speaker: Speaker;
  text: string;
}

export interface QueueState {
  appId: string;
  meetingId: string;
  nextSeq: number;
  pending: QueuedSegment[];
  /** Failed sends in a row. */
  failures: number;
  /** No send before this time, ms. */
  retryAt: number;
  lastError: string | null;
  sent: number;
}

export interface QueueStore {
  load(): Promise<QueueState | null>;
  save(state: QueueState | null): Promise<void>;
}

export type Send = (appId: string, meetingId: string, batch: QueuedSegment[]) => Promise<void>;

export const BATCH = 100;
export const BASE_DELAY_MS = 1_000;
export const MAX_DELAY_MS = 60_000;

/** The wait after `failures` failed sends in a row: 1 s, 2 s, 4 s … at most a minute. */
export function backoff(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (failures - 1));
}

export function emptyQueue(appId: string, meetingId: string): QueueState {
  return { appId, meetingId, nextSeq: 0, pending: [], failures: 0, retryAt: 0, lastError: null, sent: 0 };
}

export class UploadQueue {
  private flushing: Promise<boolean> | null = null;

  private constructor(
    private state: QueueState,
    private readonly store: QueueStore,
    private readonly send: Send,
    private readonly now: () => number,
  ) {}

  /** A new meeting's queue. */
  static async start(
    appId: string,
    meetingId: string,
    store: QueueStore,
    send: Send,
    now: () => number = Date.now,
  ): Promise<UploadQueue> {
    const q = new UploadQueue(emptyQueue(appId, meetingId), store, send, now);
    await store.save(q.state);
    return q;
  }

  /** The saved queue, if a meeting was recording. */
  static async restore(store: QueueStore, send: Send, now: () => number = Date.now): Promise<UploadQueue | null> {
    const saved = await store.load();
    return saved ? new UploadQueue(saved, store, send, now) : null;
  }

  get snapshot(): Readonly<QueueState> {
    return this.state;
  }

  get pending(): number {
    return this.state.pending.length;
  }

  /** Numbers the segment and saves it. Returns its number. */
  async add(segment: Omit<QueuedSegment, "seq">): Promise<number> {
    const text = segment.text.trim();
    const seq = this.state.nextSeq;
    if (!text) return -1;
    this.state = {
      ...this.state,
      nextSeq: seq + 1,
      pending: [...this.state.pending, { ...segment, text: text.slice(0, 4_000), seq }],
    };
    await this.store.save(this.state);
    return seq;
  }

  /** Whether a send may go now. */
  due(): boolean {
    return this.state.pending.length > 0 && this.now() >= this.state.retryAt;
  }

  /**
   * Sends the oldest batch if one is due. Returns whether the queue is empty
   * afterwards. One send at a time: a second call waits for the first.
   */
  async flush(force = false): Promise<boolean> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushOnce(force).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushOnce(force: boolean): Promise<boolean> {
    if (this.state.pending.length === 0) return true;
    if (!force && !this.due()) return false;
    const batch = [...this.state.pending].sort((a, b) => a.seq - b.seq).slice(0, BATCH);
    try {
      await this.send(this.state.appId, this.state.meetingId, batch);
    } catch (e) {
      const failures = this.state.failures + 1;
      this.state = {
        ...this.state,
        failures,
        retryAt: this.now() + backoff(failures),
        lastError: e instanceof Error ? e.message : String(e),
      };
      await this.store.save(this.state);
      return false;
    }
    const done = new Set(batch.map((s) => s.seq));
    this.state = {
      ...this.state,
      pending: this.state.pending.filter((s) => !done.has(s.seq)),
      failures: 0,
      retryAt: 0,
      lastError: null,
      sent: this.state.sent + batch.length,
    };
    await this.store.save(this.state);
    return this.state.pending.length === 0;
  }

  /**
   * Sends everything, waiting out backoffs, for at most `attempts` failed
   * sends. Returns whether it all went; what did not stays saved for later.
   */
  async drain(attempts = 6, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<boolean> {
    let failed = 0;
    while (this.state.pending.length > 0) {
      const wait = this.state.retryAt - this.now();
      if (wait > 0) await sleep(wait);
      const before = this.state.failures;
      await this.flush(true);
      if (this.state.failures > before) {
        failed += 1;
        if (failed >= attempts) return false;
      }
    }
    return true;
  }

  /** Forgets the meeting (it ended and everything was sent, or the person discarded it). */
  async clear(): Promise<void> {
    await this.store.save(null);
  }
}
