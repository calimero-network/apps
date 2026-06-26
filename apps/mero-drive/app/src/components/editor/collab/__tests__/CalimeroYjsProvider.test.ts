// Behavioural tests for the provider's flush / destroy / race robustness — the
// delicate CRDT-autosave-adjacent layer. A fake transport stands in for the
// docs WASM so we can drive failures, count appends, and inspect the log.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { CalimeroYjsProvider, type CalimeroYjsTransport } from '../CalimeroYjsProvider';

// Real timers: tests call `flush()` directly and use tiny (1ms) backoff, so the
// retry `sleep` resolves quickly. Fake timers would stall the `sleep` promise
// inside an awaited `flush()`.

// A controllable in-memory transport. `failNext` injects N consecutive append
// failures; `appendCalls` records every blob handed to the log.
class FakeTransport implements CalimeroYjsTransport {
  log: Uint8Array[] = [];
  appendCalls: Uint8Array[] = [];
  failTimes = 0;
  appendError = new Error('transport down');

  async appendDocUpdate(update: Uint8Array): Promise<void> {
    this.appendCalls.push(update);
    if (this.failTimes > 0) {
      this.failTimes -= 1;
      throw this.appendError;
    }
    this.log.push(update);
  }

  async getDocUpdates(): Promise<Uint8Array[]> {
    return this.log.map((u) => u.slice());
  }
}

// Short windows / backoff so tests run fast.
const fastOpts = { flushDebounceMs: 5, retryBackoffMs: 1, maxFlushRetries: 3 };

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CalimeroYjsProvider — flush', () => {
  it('coalesces a keystroke burst into one merged append', async () => {
    const transport = new FakeTransport();
    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);

    const t = doc.getText('t');
    t.insert(0, 'a');
    t.insert(1, 'b');
    t.insert(2, 'c');

    await prov.flush();
    // Three transactions, one append (merged).
    expect(transport.appendCalls.length).toBe(1);
    expect(transport.log.length).toBe(1);

    // The merged blob reconstructs the text on a fresh replica.
    const replica = new Y.Doc();
    Y.applyUpdate(replica, transport.log[0]);
    expect(replica.getText('t').toString()).toBe('abc');
    await prov.destroy();
    doc.destroy();
  });

  it('preserves updates enqueued DURING an in-flight flush', async () => {
    const transport = new FakeTransport();
    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);

    doc.getText('t').insert(0, 'first');
    // Start a flush but interleave a new edit before it resolves by wrapping
    // appendDocUpdate to inject the edit on the first call.
    const original = transport.appendDocUpdate.bind(transport);
    let injected = false;
    transport.appendDocUpdate = async (u: Uint8Array) => {
      if (!injected) {
        injected = true;
        doc.getText('t').insert(5, 'second'); // queued mid-flush
      }
      return original(u);
    };

    await prov.flush();
    // The mid-flush edit must not be lost — it gets its own (trailing) append.
    expect(transport.log.length).toBe(2);

    const replica = new Y.Doc();
    for (const blob of await transport.getDocUpdates()) Y.applyUpdate(replica, blob);
    expect(replica.getText('t').toString()).toBe('firstsecond');
    await prov.destroy();
    doc.destroy();
  });

  it('retries on transient failure then succeeds without dropping updates', async () => {
    const transport = new FakeTransport();
    transport.failTimes = 2; // first two appends throw, third succeeds
    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);

    doc.getText('t').insert(0, 'resilient');
    await prov.flush();

    expect(transport.appendCalls.length).toBe(3); // 2 failed + 1 ok
    expect(transport.log.length).toBe(1);
    const replica = new Y.Doc();
    Y.applyUpdate(replica, transport.log[0]);
    expect(replica.getText('t').toString()).toBe('resilient');
    await prov.destroy();
    doc.destroy();
  });

  it('single-flight: concurrent flush() callers share ONE drain (no overlapping RPCs)', async () => {
    const transport = new FakeTransport();
    // Gate the first append so multiple flush() calls pile up while it's in
    // flight, proving they attach to the same drain rather than each starting
    // their own appendDocUpdate.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = transport.appendDocUpdate.bind(transport);
    let firstCall = true;
    transport.appendDocUpdate = async (u: Uint8Array) => {
      if (firstCall) {
        firstCall = false;
        await gate;
      }
      return original(u);
    };

    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);
    doc.getText('t').insert(0, 'shared');

    // Three concurrent callers; only the first starts the loop, the rest attach.
    const a = prov.flush();
    const b = prov.flush();
    const c = prov.flush();
    release();
    await Promise.all([a, b, c]);

    // Exactly one append for the single buffered update — no overlapping RPCs.
    expect(transport.appendCalls.length).toBe(1);
    expect(transport.log.length).toBe(1);
    await prov.destroy();
    doc.destroy();
  });

  it('a concurrent flush() during the transient-empty window attaches to the in-flight drain (resolves only after the append completes)', async () => {
    // `runFlush` snapshots `pendingLocal` then clears it BEFORE awaiting the
    // append, so mid-append the buffer is transiently empty. A second flush()
    // arriving in that window must attach to the in-flight drain — NOT hit the
    // empty-check and resolve early before the append lands.
    const transport = new FakeTransport();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = transport.appendDocUpdate.bind(transport);
    let appendStarted = false;
    let appendFinished = false;
    transport.appendDocUpdate = async (u: Uint8Array) => {
      appendStarted = true;
      await gate; // hold the append open; pendingLocal is now [] (snapshotted)
      const r = await original(u);
      appendFinished = true;
      return r;
    };

    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);
    doc.getText('t').insert(0, 'x');

    // First caller starts the drain; let it reach the gated append so the buffer
    // is transiently empty while the append is in flight.
    const first = prov.flush();
    await vi.waitFor(() => expect(appendStarted).toBe(true));
    expect(appendFinished).toBe(false);

    // Second caller arrives during the empty window. It must NOT resolve before
    // the append finishes — it has to attach to the in-flight drain.
    let secondResolved = false;
    const second = prov.flush().then(() => {
      secondResolved = true;
    });
    // Give the microtask queue a turn; if `flush()` short-circuited on the empty
    // buffer it would resolve here, with the append still gated.
    await Promise.resolve();
    expect(secondResolved).toBe(false);
    expect(appendFinished).toBe(false);

    release();
    await Promise.all([first, second]);
    expect(secondResolved).toBe(true);
    expect(appendFinished).toBe(true);
    expect(transport.log.length).toBe(1);
    await prov.destroy();
    doc.destroy();
  });

  it('an update enqueued in the loop exit / clear window is drained by the same flush (not stranded for the debounce timer)', async () => {
    // An edit arriving in the loop's clear window must drain on the SAME flush,
    // not wait for the next debounce/SSE trigger. We surface that window by
    // enqueuing a fresh edit from inside the LAST batch's append: when it
    // resolves the loop re-checks, sees the edit, and keeps draining.
    const transport = new FakeTransport();
    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);

    const original = transport.appendDocUpdate.bind(transport);
    let injected = false;
    transport.appendDocUpdate = async (u: Uint8Array) => {
      const r = await original(u);
      if (!injected) {
        injected = true;
        // Enqueued as the first append's continuation settles — exercises the
        // loop-exit/clear window rather than the in-flight snapshot window.
        doc.getText('t').insert(doc.getText('t').length, 'tail');
      }
      return r;
    };

    doc.getText('t').insert(0, 'head');
    await prov.flush();

    // Both edits flushed by the single awaited flush; nothing left buffered or
    // in flight (no reliance on the debounce timer to pick up the straggler).
    expect(transport.log.length).toBe(2);
    expect(prov.hasPendingWork).toBe(false);
    const replica = new Y.Doc();
    for (const blob of await transport.getDocUpdates()) Y.applyUpdate(replica, blob);
    expect(replica.getText('t').toString()).toBe('headtail');
    await prov.destroy();
    doc.destroy();
  });

  it('drains sustained writes with a flat loop (no unbounded recursion / stack growth)', async () => {
    const transport = new FakeTransport();
    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);

    // Each append enqueues another edit for a while, so the drain loop must keep
    // iterating. A recursive tail-drain would grow the stack per iteration; a
    // flat loop handles arbitrarily many without overflow.
    const original = transport.appendDocUpdate.bind(transport);
    let remaining = 500;
    transport.appendDocUpdate = async (u: Uint8Array) => {
      const r = await original(u);
      if (remaining-- > 0) {
        doc.getText('t').insert(doc.getText('t').length, 'x');
      }
      return r;
    };

    doc.getText('t').insert(0, 'go');
    await prov.flush();
    // Every queued edit eventually flushed; buffer ends empty (no leftover).
    expect(transport.log.length).toBeGreaterThan(100);
    const replica = new Y.Doc();
    for (const blob of await transport.getDocUpdates()) Y.applyUpdate(replica, blob);
    expect(replica.getText('t').toString().startsWith('go')).toBe(true);
    await prov.destroy();
    doc.destroy();
  });

  it('a re-delivered MERGED blob is a no-op (multi-blob batch echo is deduped)', async () => {
    const transport = new FakeTransport();
    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);

    // Two distinct transactions coalesce into ONE merged blob on flush.
    const t = doc.getText('t');
    t.insert(0, 'aa');
    t.insert(2, 'bb');
    await prov.flush();
    expect(transport.appendCalls.length).toBe(1); // one merged append
    expect(transport.log.length).toBe(1);

    // The log now holds the MERGED blob. Pulling it back (as SSE re-delivery
    // would) must NOT re-apply it — the merged blob's identity is in `seen`.
    const appendsBefore = transport.appendCalls.length;
    await prov.pullRemote();
    expect(transport.appendCalls.length).toBe(appendsBefore); // no echo re-emit
    expect(doc.getText('t').toString()).toBe('aabb');
    await prov.destroy();
    doc.destroy();
  });

  it('gives up after bounded retries instead of looping forever, leaving updates buffered', async () => {
    const transport = new FakeTransport();
    transport.failTimes = Number.POSITIVE_INFINITY as unknown as number; // always fail
    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);

    doc.getText('t').insert(0, 'doomed');
    await expect(prov.flush()).rejects.toThrow('transport down');
    // maxFlushRetries=3 → 4 attempts total, then stop (no infinite loop).
    expect(transport.appendCalls.length).toBe(4);
    expect(transport.log.length).toBe(0);

    // The originals stay buffered: once the transport recovers, a later flush
    // re-sends them (nothing dropped).
    transport.failTimes = 0;
    await prov.flush();
    expect(transport.log.length).toBe(1);
    const replica = new Y.Doc();
    Y.applyUpdate(replica, transport.log[0]);
    expect(replica.getText('t').toString()).toBe('doomed');
    await prov.destroy();
    doc.destroy();
  });
});

describe('CalimeroYjsProvider — destroy', () => {
  it('flushes buffered updates pending behind the debounce timer', async () => {
    const transport = new FakeTransport();
    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);

    // Type but do NOT advance the debounce timer — the update is buffered with
    // a pending flush timer. destroy() must still flush it.
    doc.getText('t').insert(0, 'last keystrokes');
    expect(transport.log.length).toBe(0); // nothing flushed yet

    await prov.destroy();
    expect(transport.log.length).toBe(1);
    const replica = new Y.Doc();
    Y.applyUpdate(replica, transport.log[0]);
    expect(replica.getText('t').toString()).toBe('last keystrokes');
    doc.destroy();
  });

  it('awaits an in-flight flush before tearing down', async () => {
    const transport = new FakeTransport();
    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);

    doc.getText('t').insert(0, 'inflight');
    const flushing = prov.flush(); // in flight
    await prov.destroy(); // must await the in-flight flush
    await flushing;
    expect(transport.log.length).toBeGreaterThanOrEqual(1);
    doc.destroy();
  });

  it('terminates cleanly (no spin) and logs when the transport is permanently down at teardown', async () => {
    const transport = new FakeTransport();
    transport.failTimes = Number.POSITIVE_INFINITY as unknown as number; // always fail
    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);

    doc.getText('t').insert(0, 'unsaveable'); // buffered behind the debounce timer

    // destroy() must not hang or spin: once destroyed, runFlush re-buffers and
    // throws on the FIRST failure (no retry-spin at teardown), the drain loop
    // catches it, logs, and returns.
    await prov.destroy();
    // A single append attempt was made then it gave up — not an unbounded spin.
    expect(transport.appendCalls.length).toBe(1);
    expect(transport.log.length).toBe(0);
    // It surfaced the loss rather than dropping silently.
    expect(console.error).toHaveBeenCalled();
    doc.destroy();
  });

  it('does not buffer updates emitted after destroy', async () => {
    const transport = new FakeTransport();
    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);
    await prov.destroy();
    const before = transport.appendCalls.length;
    doc.getText('t').insert(0, 'too late'); // listener detached
    await prov.flush();
    expect(transport.appendCalls.length).toBe(before);
    doc.destroy();
  });
});

describe('CalimeroYjsProvider — teardown race (stale pull cannot apply)', () => {
  it('an in-flight pullRemote that resolves after destroy() does NOT apply to the doc', async () => {
    // Models the useCollabDoc teardown-vs-retry race: the old provider's initial
    // pull is still awaiting getDocUpdates when destroy() runs (the new provider
    // for the replacement doc is built afterwards). The stale pull must bail at
    // its post-await `destroyed` guard rather than apply remote bytes to a doc
    // that is being torn down.
    const remoteDoc = new Y.Doc();
    remoteDoc.getText('t').insert(0, 'stale remote');
    const remoteBlob = Y.encodeStateAsUpdate(remoteDoc);

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const transport: CalimeroYjsTransport = {
      appendDocUpdate: async () => {},
      getDocUpdates: async () => {
        await gate; // hold the pull open until after destroy()
        return [remoteBlob];
      },
    };

    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);

    const pulling = prov.pullRemote(); // in flight, parked on the gate
    // Tear down while the pull is parked. destroy() sets `destroyed` synchronously.
    const destroying = prov.destroy();
    release(); // now let getDocUpdates resolve — the guard must catch `destroyed`
    await Promise.all([pulling, destroying]);

    // The stale remote blob was NOT applied: the doc stays empty.
    expect(doc.getText('t').toString()).toBe('');
    doc.destroy();
    remoteDoc.destroy();
  });
});

describe('CalimeroYjsProvider — origin guard (no echo)', () => {
  it('applying a remote update does NOT enqueue a local emit', async () => {
    // Produce a remote blob from an independent doc.
    const remoteDoc = new Y.Doc();
    remoteDoc.getText('t').insert(0, 'from peer');
    const remoteBlob = Y.encodeStateAsUpdate(remoteDoc);

    const transport = new FakeTransport();
    transport.log.push(remoteBlob); // peer already appended it
    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);

    await prov.pullRemote(); // applies the remote blob with origin === provider
    // The applied remote update must NOT have been re-buffered/echoed back to
    // the log — appendDocUpdate must not have fired.
    expect(transport.appendCalls.length).toBe(0);
    // And the content is present locally.
    expect(doc.getText('t').toString()).toBe('from peer');

    // A subsequent flush has nothing to send (no local emit was queued).
    await prov.flush();
    expect(transport.appendCalls.length).toBe(0);
    await prov.destroy();
    doc.destroy();
    remoteDoc.destroy();
  });

  it('a genuine local edit after a remote apply still flushes', async () => {
    const remoteDoc = new Y.Doc();
    remoteDoc.getText('t').insert(0, 'peer');
    const transport = new FakeTransport();
    transport.log.push(Y.encodeStateAsUpdate(remoteDoc));
    const doc = new Y.Doc();
    const prov = new CalimeroYjsProvider(doc, transport, fastOpts);

    await prov.pullRemote();
    expect(transport.appendCalls.length).toBe(0);

    doc.getText('t').insert(0, 'mine ');
    await prov.flush();
    // The local edit DID flush (one append), proving the origin guard only
    // suppresses remote-applied updates, not real local ones.
    expect(transport.appendCalls.length).toBe(1);
    await prov.destroy();
    doc.destroy();
    remoteDoc.destroy();
  });
});
