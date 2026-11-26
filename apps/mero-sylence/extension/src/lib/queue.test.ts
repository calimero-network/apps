import { describe, expect, it } from "vitest";
import { BATCH, UploadQueue, backoff, type QueueState, type QueueStore, type QueuedSegment } from "./queue";

function memoryStore(): QueueStore & { value: QueueState | null; saves: number } {
  const s = {
    value: null as QueueState | null,
    saves: 0,
    async load() {
      return s.value ? structuredClone(s.value) : null;
    },
    async save(v: QueueState | null) {
      s.saves += 1;
      s.value = v ? structuredClone(v) : null;
    },
  };
  return s;
}

/** A node: stores segments by number, skips repeats, can fail or lose its answer. */
function node() {
  const stored = new Map<number, QueuedSegment>();
  const calls: number[][] = [];
  const n = {
    stored,
    calls,
    failNext: 0,
    loseAnswerNext: 0,
    send: async (_app: string, _meeting: string, batch: QueuedSegment[]) => {
      calls.push(batch.map((s) => s.seq));
      if (n.failNext > 0) {
        n.failNext -= 1;
        throw new Error("offline");
      }
      for (const s of batch) if (!stored.has(s.seq)) stored.set(s.seq, s);
      if (n.loseAnswerNext > 0) {
        n.loseAnswerNext -= 1;
        throw new Error("timeout");
      }
    },
  };
  return n;
}

const seg = (i: number) => ({ speaker: (i % 2 ? "you" : "others") as "you" | "others", startMs: i * 1000, endMs: i * 1000 + 900, text: `line ${i}` });

describe("upload queue", () => {
  it("numbers segments and sends them in order, at most 100 at a time", async () => {
    const store = memoryStore();
    const n = node();
    const q = await UploadQueue.start("app", "m1", store, n.send, () => 0);
    for (let i = 0; i < 230; i++) expect(await q.add(seg(i))).toBe(i);
    expect(await q.flush()).toBe(false);
    expect(await q.flush()).toBe(false);
    expect(await q.flush()).toBe(true);
    expect(n.calls.map((c) => c.length)).toEqual([BATCH, BATCH, 30]);
    expect(n.calls[1]![0]).toBe(100);
    expect([...n.stored.keys()]).toEqual([...Array(230).keys()]);
    expect(q.snapshot.sent).toBe(230);
  });

  it("skips empty text without using a number", async () => {
    const q = await UploadQueue.start("app", "m1", memoryStore(), node().send, () => 0);
    expect(await q.add({ ...seg(0), text: "  " })).toBe(-1);
    expect(await q.add(seg(1))).toBe(0);
    expect(q.snapshot.pending[0]!.text).toBe("line 1");
  });

  it("backs off after failures, then succeeds", async () => {
    let now = 1_000;
    const n = node();
    n.failNext = 3;
    const q = await UploadQueue.start("app", "m1", memoryStore(), n.send, () => now);
    await q.add(seg(0));
    await q.flush();
    expect(q.snapshot.failures).toBe(1);
    expect(q.snapshot.retryAt).toBe(2_000);
    expect(q.snapshot.lastError).toBe("offline");
    expect(q.due()).toBe(false);
    expect(await q.flush()).toBe(false);
    expect(n.calls).toHaveLength(1);
    now = 2_000;
    await q.flush();
    expect(q.snapshot.retryAt).toBe(2_000 + 2_000);
    now = 4_000;
    await q.flush();
    expect(q.snapshot.retryAt).toBe(4_000 + 4_000);
    now = 8_000;
    expect(await q.flush()).toBe(true);
    expect(q.snapshot.failures).toBe(0);
    expect(q.snapshot.lastError).toBeNull();
  });

  it("caps the backoff at a minute", () => {
    expect(backoff(0)).toBe(0);
    expect(backoff(1)).toBe(1_000);
    expect(backoff(4)).toBe(8_000);
    expect(backoff(30)).toBe(60_000);
  });

  it("resends a batch whose answer was lost; the node keeps one copy", async () => {
    const n = node();
    n.loseAnswerNext = 1;
    const q = await UploadQueue.start("app", "m1", memoryStore(), n.send, () => 0);
    for (let i = 0; i < 3; i++) await q.add(seg(i));
    await q.flush(true);
    expect(q.pending).toBe(3);
    await q.add(seg(3));
    expect(await q.flush(true)).toBe(true);
    expect(n.calls).toEqual([
      [0, 1, 2],
      [0, 1, 2, 3],
    ]);
    expect(n.stored.size).toBe(4);
  });

  it("carries on after a restart from what it saved", async () => {
    const store = memoryStore();
    const n = node();
    n.failNext = 1;
    const q = await UploadQueue.start("app", "m1", store, n.send, () => 0);
    await q.add(seg(0));
    await q.add(seg(1));
    await q.flush(true);
    // The service worker stops; a new one restores the queue.
    const again = await UploadQueue.restore(store, n.send, () => 10_000);
    expect(again?.snapshot.meetingId).toBe("m1");
    expect(again?.pending).toBe(2);
    expect(await again!.add(seg(2))).toBe(2);
    expect(await again!.flush()).toBe(true);
    expect([...n.stored.keys()]).toEqual([0, 1, 2]);
    await again!.clear();
    expect(await UploadQueue.restore(store, n.send)).toBeNull();
  });

  it("drains everything on stop, waiting out backoffs", async () => {
    let now = 0;
    const waits: number[] = [];
    const n = node();
    n.failNext = 2;
    const q = await UploadQueue.start("app", "m1", memoryStore(), n.send, () => now);
    for (let i = 0; i < 150; i++) await q.add(seg(i));
    const ok = await q.drain(6, async (ms) => {
      waits.push(ms);
      now += ms;
    });
    expect(ok).toBe(true);
    expect(waits).toEqual([1_000, 2_000]);
    expect(n.stored.size).toBe(150);
  });

  it("gives up draining after repeated failures and keeps the rest saved", async () => {
    const store = memoryStore();
    const n = node();
    n.failNext = 99;
    let now = 0;
    const q = await UploadQueue.start("app", "m1", store, n.send, () => now);
    await q.add(seg(0));
    expect(
      await q.drain(3, async (ms) => {
        now += ms;
      }),
    ).toBe(false);
    expect(store.value?.pending).toHaveLength(1);
  });

  it("sends one batch at a time even when asked twice", async () => {
    const n = node();
    const q = await UploadQueue.start("app", "m1", memoryStore(), n.send, () => 0);
    await q.add(seg(0));
    await Promise.all([q.flush(), q.flush()]);
    expect(n.calls).toHaveLength(1);
  });
});
