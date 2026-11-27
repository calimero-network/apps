/** Edge cases of the recorder's building blocks: hostile addresses, a queue under load, the scheduler's bookkeeping. */
import { describe, expect, it } from "vitest";
import { detectPlatform, isInCall, meetingUrl } from "./platform";
import { UploadQueue, type QueueState, type QueueStore, type QueuedSegment } from "./queue";
import { Scheduler } from "./scheduler";
import { Segmenter } from "./segmenter";
import { Resampler } from "./resample";

describe("platform: look-alike addresses are not calls", () => {
  it.each([
    "https://meet.google.com.evil.example/abc-defg-hij",
    "https://evilzoom.us/j/123",
    "https://zoom.us.evil.example/j/123",
    "https://teams.microsoft.com.evil.example/",
    "https://notteams.live.com/meet/1",
    "https://evil.example/?u=https://meet.google.com/abc-defg-hij",
    "file:///meet.google.com/abc-defg-hij",
  ])("%s", (url) => {
    expect(detectPlatform(url)).toBe("other");
    expect(isInCall(url)).toBe(false);
  });

  it("matches hosts without case and Teams' new domain", () => {
    expect(detectPlatform("https://MEET.GOOGLE.COM/abc-defg-hij")).toBe("meet");
    expect(detectPlatform("https://teams.cloud.microsoft/")).toBe("teams");
    expect(detectPlatform("https://foo.teams.microsoft.com/x")).toBe("teams");
  });

  it("never keeps credentials in the saved address", () => {
    expect(meetingUrl("https://user:pass@us02web.zoom.us/j/1?pwd=x")).toBe("https://us02web.zoom.us/j/1");
    expect(meetingUrl(`https://meet.google.com/${"a".repeat(3_000)}`)).toHaveLength(2_000);
  });
});

function memoryStore(): QueueStore & { value: QueueState | null } {
  const s = {
    value: null as QueueState | null,
    async load() {
      return s.value ? structuredClone(s.value) : null;
    },
    async save(v: QueueState | null) {
      s.value = v ? structuredClone(v) : null;
    },
  };
  return s;
}

const seg = (i: number) => ({ speaker: "others" as const, startMs: i * 1_000, endMs: i * 1_000 + 900, text: `line ${i}` });

describe("upload queue under load", () => {
  it("keeps segments added while a send is in flight", async () => {
    const store = memoryStore();
    const sent: number[][] = [];
    let release: () => void = () => undefined;
    const send = async (_a: string, _m: string, batch: QueuedSegment[]) => {
      sent.push(batch.map((s) => s.seq));
      if (sent.length === 1) await new Promise<void>((r) => (release = r));
    };
    const q = await UploadQueue.start("app", "m", store, send, () => 0);
    await q.add(seg(0));
    await q.add(seg(1));
    const flushing = q.flush();
    await Promise.resolve();
    await q.add(seg(2));
    release();
    expect(await flushing).toBe(false);
    expect(q.snapshot.pending.map((s) => s.seq)).toEqual([2]);
    expect(store.value!.pending.map((s) => s.seq)).toEqual([2]);
    expect(await q.flush()).toBe(true);
    expect(sent).toEqual([[0, 1], [2]]);
  });

  it("trims text and cuts it to what the contract takes", async () => {
    const store = memoryStore();
    const batches: QueuedSegment[][] = [];
    const q = await UploadQueue.start("app", "m", store, async (_a, _m, b) => void batches.push(b), () => 0);
    await q.add({ ...seg(0), text: `  ${"x".repeat(5_000)}  ` });
    await q.flush();
    expect(batches[0]![0]!.text).toHaveLength(4_000);
    expect(batches[0]![0]!.text.startsWith("x")).toBe(true);
  });

  it("restores nothing when nothing was recording", async () => {
    expect(await UploadQueue.restore(memoryStore(), async () => undefined)).toBeNull();
  });

  it("a restored queue keeps numbering where it stopped", async () => {
    const store = memoryStore();
    const q = await UploadQueue.start("app", "m", store, async () => undefined, () => 0);
    for (let i = 0; i < 5; i++) await q.add(seg(i));
    const again = (await UploadQueue.restore(store, async () => undefined, () => 0))!;
    expect(await again.add(seg(5))).toBe(5);
    expect(again.pending).toBe(6);
  });

  it("a thousand segments go out in order, each once, despite flaky sends", async () => {
    const store = memoryStore();
    const got = new Map<number, string>();
    let n = 0;
    const send = async (_a: string, _m: string, batch: QueuedSegment[]) => {
      n += 1;
      if (n % 3 === 0) throw new Error("flaky");
      for (const s of batch) if (!got.has(s.seq)) got.set(s.seq, s.text);
      if (n % 4 === 0) throw new Error("answer lost");
    };
    let now = 0;
    const q = await UploadQueue.start("app", "m", store, send, () => now);
    for (let i = 0; i < 1_000; i++) await q.add(seg(i));
    const ok = await q.drain(50, async (ms) => {
      now += ms;
    });
    expect(ok).toBe(true);
    expect(got.size).toBe(1_000);
    expect([...got.keys()].sort((a, b) => a - b)).toEqual([...Array(1_000).keys()]);
    expect(got.get(999)).toBe("line 999");
  });
});

describe("scheduler bookkeeping", () => {
  const chunk = (startMs: number, ms: number) => ({ startMs, endMs: startMs + ms, audio: new Float32Array(1) });

  it("knows when a stretch is with the model", () => {
    const s = new Scheduler();
    expect(s.working).toBe(false);
    s.enqueue(chunk(0, 1_000), "you");
    expect(s.working).toBe(false);
    const job = s.take()!;
    expect(s.working).toBe(true);
    expect(s.take()).toBeNull();
    s.done(job.id, 100);
    expect(s.working).toBe(false);
    expect(s.idle).toBe(true);
  });

  it("ignores an answer for a stretch it did not send", () => {
    const s = new Scheduler();
    s.enqueue(chunk(0, 1_000), "you");
    const job = s.take()!;
    expect(s.done(job.id + 100, 50)).toBeNull();
    expect(s.working).toBe(true);
    expect(s.done(job.id, 50)).toBe(job);
  });

  it("counts the stretch with the model in the backlog", () => {
    const s = new Scheduler();
    s.enqueue(chunk(0, 2_000), "you");
    s.enqueue(chunk(3_000, 1_500), "others");
    s.take();
    expect(s.backlogSec).toBeCloseTo(3.5);
  });
});

describe("segmenter over a long call", () => {
  it("finds every phrase of a ten-minute call, in order, with no overlap", () => {
    const rate = 16_000;
    const seg = new Segmenter();
    const r = new Resampler(48_000);
    const tone = (ms: number) => Float32Array.from({ length: (48_000 * ms) / 1000 }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 200 * i) / 48_000));
    const quiet = (ms: number) => new Float32Array((48_000 * ms) / 1000);
    const chunks = [];
    const feed = (a: Float32Array) => {
      for (let i = 0; i < a.length; i += 128 * 8) chunks.push(...seg.push(r.push(a.slice(i, i + 128 * 8))));
    };
    feed(quiet(1_000));
    // 100 phrases of 3 s with 3 s pauses: 10 minutes.
    for (let i = 0; i < 100; i++) {
      feed(tone(3_000));
      feed(quiet(3_000));
    }
    chunks.push(...seg.flush());
    expect(chunks).toHaveLength(100);
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      const speechAt = 1_000 + i * 6_000;
      expect(c.startMs).toBeGreaterThanOrEqual(speechAt - 300);
      expect(c.startMs).toBeLessThanOrEqual(speechAt + 50);
      expect(c.audio.length / rate).toBeGreaterThan(2.9);
      if (i > 0) expect(c.startMs).toBeGreaterThanOrEqual(chunks[i - 1]!.endMs);
    }
  });
});
