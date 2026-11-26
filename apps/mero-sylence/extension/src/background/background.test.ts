/**
 * The service worker as a state machine, against a fake `chrome.*` and a fake
 * node: start → capture → segments → stop → drained → saved, and every way a
 * recording can go wrong on the way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AuthState, type OffscreenCommand, type OffscreenEvent, type RecorderStatus, type Reply } from "../lib/messages";
import type { QueuedSegment, QueueState } from "../lib/queue";

// ── a fake node ──────────────────────────────────────────────────────────────

interface Meeting {
  id: string;
  appId: string;
  title: string;
  platform: string;
  model: string;
  ended: boolean;
  durationMs: number;
  segments: Map<number, QueuedSegment>;
  summary?: string;
}

class FakeNode {
  meetings = new Map<string, Meeting>();
  deleted: string[] = [];
  appendCalls = 0;
  dropCalls: [number, number][] = [];
  /** Calls to fail with "offline" before answering again. */
  offline = 0;
  /** Fail every append (the node is down for the whole recording). */
  down = false;
  signedOut = false;
  actions: Array<{ meetingId: string; text: string; assignee: string; sourceSeq: number }> = [];
  apps: Array<{ appId: string; name: string; package: string }> = [{ appId: "app1", name: "Team", package: "com.calimero.sylence" }];
  private n = 0;

  private gate(): void {
    if (this.offline > 0) {
      this.offline -= 1;
      throw new Error("offline");
    }
  }

  app(appId: string) {
    return {
      startMeeting: async (a: { title: string; platform: string; model: string }) => {
        this.gate();
        const id = `m${++this.n}`;
        this.meetings.set(id, { id, appId, ...a, ended: false, durationMs: 0, segments: new Map(), summary: "" });
        return id;
      },
      appendSegments: async (a: { meetingId: string; segments: QueuedSegment[] }) => {
        this.appendCalls += 1;
        if (this.down) throw new Error("node unreachable");
        this.gate();
        const m = this.meetings.get(a.meetingId);
        if (!m) throw new Error("no such meeting");
        for (const s of a.segments) if (!m.segments.has(s.seq)) m.segments.set(s.seq, s);
        return { added: a.segments.length, skipped: 0, nextSeq: m.segments.size };
      },
      endMeeting: async (a: { meetingId: string; durationMs: number }) => {
        this.gate();
        const m = this.meetings.get(a.meetingId)!;
        m.ended = true;
        m.durationMs = a.durationMs;
        return {};
      },
      transcript: async (a: { meetingId: string; fromSeq: number; limit: number }) => {
        const all = [...(this.meetings.get(a.meetingId)?.segments.values() ?? [])].sort((x, y) => x.seq - y.seq);
        const from = all.filter((x) => x.seq >= a.fromSeq);
        const page = from.slice(0, a.limit);
        return { segments: page, next: from.length > a.limit ? page.at(-1)!.seq + 1 : null };
      },
      getMeeting: async (a: { meetingId: string }) => {
        const m = this.meetings.get(a.meetingId);
        const seqs = [...(m?.segments.keys() ?? [])];
        return { summary: m?.summary ?? "", nextSeq: seqs.length ? Math.max(...seqs) + 1 : 0 };
      },
      dropSegments: async (a: { meetingId: string; fromSeq: number; beforeSeq: number }) => {
        this.dropCalls.push([a.fromSeq, a.beforeSeq]);
        const m = this.meetings.get(a.meetingId)!;
        let removed = 0;
        for (const seq of [...m.segments.keys()]) {
          if (seq >= a.fromSeq && seq < a.beforeSeq) {
            m.segments.delete(seq);
            removed++;
          }
        }
        return { removed, remaining: 0 };
      },
      setSummary: async (a: { meetingId: string; summary: string }) => {
        this.meetings.get(a.meetingId)!.summary = a.summary;
        return {};
      },
      listActions: async (a: { meetingId: string }) => this.actions.filter((x) => x.meetingId === a.meetingId),
      addAction: async (a: { meetingId: string; text: string; assignee: string; sourceSeq: number }) => {
        this.actions.push(a);
        return `a${this.actions.length}`;
      },
      deleteMeeting: async (a: { meetingId: string }) => {
        this.deleted.push(a.meetingId);
        this.meetings.delete(a.meetingId);
        return { remaining: 0 };
      },
    };
  }

  texts(id: string): string[] {
    const m = this.meetings.get(id);
    if (!m) return [];
    return [...m.segments.values()].sort((a, b) => a.seq - b.seq).map((s) => s.text);
  }
}

let node: FakeNode;

class LoginRequired extends Error {}

vi.mock("../lib/session", () => ({
  withClient: async (
    auth: AuthState,
    _save: unknown,
    work: (client: unknown, app: unknown) => Promise<unknown>,
  ) => {
    if (node.signedOut) throw new LoginRequired("session over");
    if (node.offline > 0) {
      node.offline -= 1;
      throw new Error("offline");
    }
    const client = { apps: { list: async () => ({ apps: node.apps }) } };
    return work(client, node.app(auth.workspace?.appId ?? ""));
  },
  isSignedOut: (e: unknown) => e instanceof LoginRequired,
  describe: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

// ── a fake chrome ────────────────────────────────────────────────────────────

type Listener = (message: unknown, sender: { id?: string; tab?: { id: number } }, respond: (r: unknown) => void) => boolean | void;

interface Harness {
  local: Map<string, unknown>;
  session: Map<string, unknown>;
  toOffscreen: OffscreenCommand[];
  /** Answers offscreen commands (caps, capture, stop). */
  offscreen: (c: OffscreenCommand) => Promise<unknown>;
  offscreenOpen: boolean;
  offscreenCreated: number;
  offscreenClosed: number;
  streamIdError: Error | null;
  streamIdsTaken: number;
  removedListeners: ((tabId: number) => void)[];
  startupListeners: (() => void)[];
  listener: Listener | null;
  /** The tab Record is pressed on. */
  tab: { url: string; title: string };
  /** Tabs the speaker reader was injected into, and messages sent to tabs. */
  injected: number[];
  tabMessages: { tabId: number; message: unknown }[];
}

function installChrome(): Harness {
  const h: Harness = {
    local: new Map(),
    session: new Map(),
    toOffscreen: [],
    offscreen: async (c) => {
      if (c.type === "caps") return { webgpu: false, deviceMemoryGb: 8, cores: 8, cached: ["light", "ultralight"] };
      return true;
    },
    offscreenOpen: false,
    offscreenCreated: 0,
    offscreenClosed: 0,
    streamIdError: null,
    streamIdsTaken: 0,
    removedListeners: [],
    startupListeners: [],
    listener: null,
    tab: { url: "https://meet.google.com/abc-defg-hij", title: "Meet - Weekly sync" },
    injected: [],
    tabMessages: [],
  };
  const area = (map: Map<string, unknown>) => ({
    get: async (key: string) => (map.has(key) ? { [key]: structuredClone(map.get(key)) } : {}),
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) map.set(k, structuredClone(v));
    },
    remove: async (key: string) => {
      map.delete(key);
    },
  });
  const chromeLike = {
    storage: { local: area(h.local), session: area(h.session), onChanged: { addListener() {}, removeListener() {} } },
    runtime: {
      id: "ext",
      getURL: (p: string) => `chrome-extension://ext/${p}`,
      ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
      getContexts: async () => (h.offscreenOpen ? [{}] : []),
      sendMessage: async (m: OffscreenCommand) => {
        h.toOffscreen.push(m);
        if (!h.offscreenOpen) throw new Error("Could not establish connection. Receiving end does not exist.");
        return h.offscreen(m);
      },
      onMessage: { addListener: (l: Listener) => (h.listener = l) },
      onStartup: { addListener: (l: () => void) => h.startupListeners.push(l) },
    },
    offscreen: {
      Reason: { USER_MEDIA: "USER_MEDIA", AUDIO_PLAYBACK: "AUDIO_PLAYBACK" },
      createDocument: async () => {
        h.offscreenOpen = true;
        h.offscreenCreated += 1;
      },
      closeDocument: async () => {
        h.offscreenOpen = false;
        h.offscreenClosed += 1;
      },
    },
    tabCapture: {
      getMediaStreamId: async () => {
        h.streamIdsTaken += 1;
        if (h.streamIdError) throw h.streamIdError;
        return `stream-${h.streamIdsTaken}`;
      },
    },
    tabs: {
      get: async (id: number) => ({ id, ...h.tab }),
      onRemoved: { addListener: (l: (tabId: number) => void) => h.removedListeners.push(l) },
      sendMessage: async (tabId: number, message: unknown) => {
        h.tabMessages.push({ tabId, message });
      },
    },
    scripting: {
      executeScript: async ({ target }: { target: { tabId: number } }) => {
        h.injected.push(target.tabId);
        return [];
      },
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeLike;
  return h;
}

const AUTH: AuthState = {
  accountId: "acc",
  session: { accountId: "acc", sessionToken: "s", expiresAt: 0, refreshToken: "r" },
  nodeUrl: "http://localhost:2501",
  nodes: [],
  page: { origin: "http://localhost:5173", version: null },
  workspace: { appId: "app1", name: "Team" },
};

let h: Harness;

/** Settles every pending promise chain (storage writes are async). */
async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}

function request(message: unknown): Promise<Reply> {
  return new Promise((resolve) => {
    const async = h.listener!(message, { id: "ext" }, (r) => resolve(r as Reply));
    if (async !== true) resolve({ ok: true, value: undefined });
  });
}

type Event = OffscreenEvent extends infer E ? (E extends OffscreenEvent ? Omit<E, "source"> : never) : never;

async function event(e: Event): Promise<void> {
  h.listener!({ ...e, source: "offscreen" }, {}, () => undefined);
  await settle();
}

const status = () => h.session.get("sylence:status") as RecorderStatus;
const savedQueue = () => h.local.get("sylence:queue") as QueueState | undefined;
const logLines = () => (h.session.get("sylence:log") as string[] | undefined) ?? [];

async function boot(): Promise<void> {
  vi.resetModules();
  node = new FakeNode();
  h = installChrome();
  h.local.set("sylence:auth", AUTH);
  await import("./index");
}

const segment = (speaker: "you" | "others", startMs: number, text: string, startedAt?: number) =>
  ({ type: "segment", speaker, startMs, endMs: startMs + 2_000, text, startedAt }) as const;

/** The call page's reader reporting who is talking, from tab `tab`. */
async function speakers(at: number, speaking: string[], extra: { participants?: string[]; self?: string | null; tab?: number } = {}): Promise<void> {
  h.listener!(
    { source: "speakers", type: "speakers", at, platform: "meet", speaking, participants: extra.participants ?? [], self: extra.self ?? null, via: "meet-tiles" },
    { tab: { id: extra.tab ?? 7 } },
    () => undefined,
  );
  await settle();
}

beforeEach(async () => {
  vi.useRealTimers();
  await boot();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("service worker: a recording", () => {
  it("starts, records, stops and saves the whole transcript", async () => {
    const r = await request({ type: "start", tabId: 7 });
    expect(r).toEqual({ ok: true, value: undefined });
    const st = status();
    expect(st.phase).toBe("loading-model");
    expect(st.meeting).toMatchObject({ id: "m1", appId: "app1", title: "Weekly sync", platform: "meet" });
    expect(node.meetings.get("m1")).toMatchObject({ title: "Weekly sync", platform: "meet", model: expect.any(String) });
    // The offscreen page was opened, asked what the laptop can do, then told to capture.
    expect(h.offscreenCreated).toBe(1);
    expect(h.toOffscreen.map((c) => c.type)).toEqual(["caps", "capture"]);
    expect(h.toOffscreen[1]).toMatchObject({ streamId: "stream-1", mic: true, language: "en" });

    await event({ type: "model", tier: "light", state: "ready" });
    expect(status().phase).toBe("recording");

    await event(segment("others", 0, "Good morning everyone"));
    await event(segment("you", 2_500, "  Morning, shall we start?  "));
    expect(node.texts("m1")).toEqual(["Good morning everyone", "Morning, shall we start?"]);
    expect(status().lines.map((l) => l.text)).toEqual(["Good morning everyone", "Morning, shall we start?"]);
    expect(h.session.get("sylence:transcript")).toHaveLength(2);

    await request({ type: "stop" });
    expect(status().phase).toBe("stopping");
    expect(h.toOffscreen.at(-1)).toEqual({ target: "offscreen", type: "stop" });

    // What was still being transcribed arrives before `drained`.
    await event(segment("others", 5_000, "Last words"));
    await event({ type: "drained", durationMs: 61_000 });
    const done = status();
    expect(done.phase).toBe("saved");
    expect(done.link).toContain("m1");
    expect(done.pending).toBe(0);
    expect(done.error).toBeNull();
    const m = node.meetings.get("m1")!;
    expect(m.ended).toBe(true);
    expect(m.durationMs).toBe(61_000);
    expect(node.texts("m1")).toEqual(["Good morning everyone", "Morning, shall we start?", "Last words"]);
    expect(savedQueue()).toBeUndefined();
    expect(h.offscreenOpen).toBe(false);
    // The log names steps, never what was said.
    expect(logLines().join("\n")).not.toContain("Good morning");
  });

  it("keeps the last segment when drained arrives right behind it", async () => {
    await request({ type: "start", tabId: 7 });
    await event({ type: "model", tier: "light", state: "ready" });
    await request({ type: "stop" });
    // Both delivered in the same tick, as the offscreen page sends them.
    h.listener!({ ...segment("others", 0, "final sentence"), source: "offscreen" }, {}, () => undefined);
    h.listener!({ type: "drained", durationMs: 3_000, source: "offscreen" }, {}, () => undefined);
    await settle(60);
    expect(status().phase).toBe("saved");
    expect(node.texts("m1")).toEqual(["final sentence"]);
    expect(savedQueue()).toBeUndefined();
  });

  it("numbers segments in arrival order even when they come in a burst", async () => {
    await request({ type: "start", tabId: 7 });
    await event({ type: "model", tier: "light", state: "ready" });
    for (let i = 0; i < 12; i++) h.listener!({ ...segment("others", i * 1_000, `line ${i}`), source: "offscreen" }, {}, () => undefined);
    await settle(80);
    const seqs = [...node.meetings.get("m1")!.segments.values()].map((s) => [s.seq, s.text]);
    expect(seqs.sort((a, b) => (a[0] as number) - (b[0] as number))).toEqual(
      Array.from({ length: 12 }, (_, i) => [i, `line ${i}`]),
    );
    expect(status().lines).toHaveLength(6);
    expect(h.session.get("sylence:transcript")).toHaveLength(12);
  });

  it("refuses a second start while recording", async () => {
    await request({ type: "start", tabId: 7 });
    const again = await request({ type: "start", tabId: 8 });
    expect(again).toEqual({ ok: false, error: "Already recording." });
    expect(node.meetings.size).toBe(1);
  });

  it("asks for sign-in and a workspace before recording", async () => {
    h.local.set("sylence:auth", { ...AUTH, workspace: null });
    expect(await request({ type: "start", tabId: 7 })).toEqual({ ok: false, error: "Choose a workspace first." });
    h.local.delete("sylence:auth");
    expect(await request({ type: "start", tabId: 7 })).toEqual({ ok: false, error: "Sign in first." });
    expect(node.meetings.size).toBe(0);
  });

  it("takes the tab's stream id last, after the meeting exists", async () => {
    await request({ type: "start", tabId: 7 });
    expect(h.streamIdsTaken).toBe(1);
    const order = logLines().map((l) => l.slice(13));
    const startAt = order.findIndex((l) => l.startsWith("start:"));
    const takenAt = order.findIndex((l) => l.startsWith("tab stream id taken"));
    expect(startAt).toBeGreaterThanOrEqual(0);
    expect(takenAt).toBeGreaterThan(startAt);
  });
});

describe("service worker: when recording goes wrong", () => {
  it("deletes the empty meeting when the tab can't be captured", async () => {
    h.streamIdError = new Error("Error starting tab capture");
    const r = await request({ type: "start", tabId: 7 });
    expect(r).toEqual({ ok: false, error: "Error starting tab capture" });
    expect(node.deleted).toEqual(["m1"]);
    expect(node.meetings.size).toBe(0);
    expect(status()).toMatchObject({ phase: "error", error: "Error starting tab capture" });
    expect(savedQueue()).toBeUndefined();
    expect(h.offscreenOpen).toBe(false);
    // And a new recording can start afterwards.
    h.streamIdError = null;
    expect((await request({ type: "start", tabId: 7 })).ok).toBe(true);
    expect(status().phase).toBe("loading-model");
  });

  it("deletes the empty meeting when the offscreen page reports a capture error", async () => {
    await request({ type: "start", tabId: 7 });
    await event({ type: "captureError", message: "Could not record the tab: Error starting tab capture" });
    expect(node.deleted).toEqual(["m1"]);
    const st = status();
    expect(st.phase).toBe("error");
    expect(st.error).toBe("Could not record the tab: Error starting tab capture");
    expect(st.meeting).toBeNull();
    expect(savedQueue()).toBeUndefined();
    expect(h.offscreenOpen).toBe(false);
  });

  it("deletes the empty meeting when the offscreen page is gone before capture", async () => {
    h.offscreen = async (c) => {
      if (c.type === "caps") return { webgpu: false, deviceMemoryGb: 8, cores: 8, cached: [] };
      throw new Error("Receiving end does not exist.");
    };
    const r = await request({ type: "start", tabId: 7 });
    expect(r.ok).toBe(false);
    expect(status().phase).toBe("error");
    expect(node.deleted).toEqual(["m1"]);
    expect(savedQueue()).toBeUndefined();
  });

  it("shows why when the node refuses to start a meeting", async () => {
    node.offline = 1;
    const r = await request({ type: "start", tabId: 7 });
    expect(r).toEqual({ ok: false, error: "offline" });
    expect(status()).toMatchObject({ phase: "error", error: "offline" });
    // Nothing was captured: no stream id was spent.
    expect(h.streamIdsTaken).toBe(0);
    expect(h.offscreenOpen).toBe(false);
  });

  it("adds the action items said in the meeting when it ends", async () => {
    await request({ type: "start", tabId: 7 });
    await event({ type: "model", tier: "light", state: "ready" });
    await event(segment("you", 0, "Okay. Ana, can you send the deck to the design team by Friday?"));
    await event(segment("others", 3_000, "Sure. Can you hear me okay?"));
    await event(segment("others", 6_000, "I'll update the pricing page tomorrow."));
    await request({ type: "stop" });
    await event({ type: "drained", durationMs: 9_000 });
    expect(status().phase).toBe("saved");
    expect(status().actions).toBe(2);
    expect(node.actions).toEqual([
      { meetingId: "m1", text: "Send the deck to the design team by Friday", assignee: "Ana", sourceSeq: 0 },
      { meetingId: "m1", text: "Update the pricing page tomorrow", assignee: "", sourceSeq: 2 },
    ]);
  });

  it("adds no action items when that is turned off", async () => {
    h.local.set("sylence:settings", { tier: "auto", language: "en", mic: true, pageOverride: "", autoActions: false });
    await request({ type: "start", tabId: 7 });
    await event({ type: "model", tier: "light", state: "ready" });
    await event(segment("you", 0, "Ana, can you send the deck by Friday?"));
    await request({ type: "stop" });
    await event({ type: "drained", durationMs: 3_000 });
    expect(status().phase).toBe("saved");
    expect(node.actions).toEqual([]);
  });

  it("stopping before the model is ready still waits for the transcript", async () => {
    await request({ type: "start", tabId: 7 });
    expect(status().phase).toBe("loading-model");
    await request({ type: "stop" });
    expect(status().phase).toBe("stopping");
    // Not saved until the offscreen page says it transcribed everything.
    await settle();
    expect(status().phase).toBe("stopping");
    await event({ type: "model", tier: "light", state: "ready" });
    // Ready while stopping does not flip back to recording.
    expect(status().phase).toBe("stopping");
    await event(segment("others", 0, "captured while loading"));
    await event({ type: "drained", durationMs: 9_000 });
    expect(status().phase).toBe("saved");
    expect(node.texts("m1")).toEqual(["captured while loading"]);
  });

  it("saves the meeting even if the offscreen page does not answer stop", async () => {
    await request({ type: "start", tabId: 7 });
    await event(segment("others", 0, "kept"));
    h.offscreenOpen = false; // crashed
    await request({ type: "stop" });
    await settle(60);
    expect(status().phase).toBe("saved");
    expect(node.meetings.get("m1")!.ended).toBe(true);
    expect(node.texts("m1")).toEqual(["kept"]);
  });

  it("keeps lines the node did not take and says so", async () => {
    await request({ type: "start", tabId: 7 });
    await event({ type: "model", tier: "light", state: "ready" });
    node.down = true;
    await event(segment("others", 0, "one"));
    await event(segment("others", 2_000, "two"));
    expect(status().uploadError).toBe("node unreachable");
    expect(status().pending).toBe(2);
    // Drain waits out its backoffs: run it on fake time.
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"], shouldAdvanceTime: true, advanceTimeDelta: 1_000 });
    await request({ type: "stop" });
    h.listener!({ type: "drained", durationMs: 4_000, source: "offscreen" }, {}, () => undefined);
    for (let i = 0; i < 400 && status().phase !== "saved"; i++) await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();
    const st = status();
    expect(st.phase).toBe("saved");
    expect(st.pending).toBe(2);
    expect(st.uploadError).toMatch(/still waiting/);
    // Kept for later, with the meeting it belongs to.
    expect(savedQueue()).toMatchObject({ appId: "app1", meetingId: "m1" });
    expect(savedQueue()!.pending.map((s) => s.text)).toEqual(["one", "two"]);
  });

  it("sends what was waiting when the browser starts again", async () => {
    h.local.set("sylence:queue", {
      appId: "app1",
      meetingId: "m1",
      nextSeq: 2,
      pending: [
        { seq: 0, startMs: 0, endMs: 1, speaker: "you", text: "left over" },
        { seq: 1, startMs: 1, endMs: 2, speaker: "others", text: "from before" },
      ],
      failures: 3,
      retryAt: Date.now() + 60_000,
      lastError: "offline",
      sent: 0,
    } satisfies QueueState);
    node.meetings.set("m1", { id: "m1", appId: "app1", title: "t", platform: "meet", model: "x", ended: true, durationMs: 1, segments: new Map() });
    for (const l of h.startupListeners) l();
    await settle(40);
    expect(node.texts("m1")).toEqual(["left over", "from before"]);
    expect(savedQueue()!.pending).toEqual([]);
  });

  it("stops when the meeting tab is closed", async () => {
    await request({ type: "start", tabId: 7 });
    await event({ type: "model", tier: "light", state: "ready" });
    for (const l of h.removedListeners) l(99);
    await settle();
    expect(status().phase).toBe("recording");
    for (const l of h.removedListeners) l(7);
    await settle();
    expect(status().phase).toBe("stopping");
    expect(h.toOffscreen.at(-1)).toEqual({ target: "offscreen", type: "stop" });
  });

  it("signs out when the node says the session is over", async () => {
    node.signedOut = true;
    const r = await request({ type: "start", tabId: 7 });
    expect(r.ok).toBe(false);
    expect(h.local.has("sylence:auth")).toBe(false);
  });

  it("steps down and shows a notice", async () => {
    await request({ type: "start", tabId: 7 });
    await event({ type: "stepDown", from: "light", to: "ultralight" });
    expect(status().tier).toBe("ultralight");
    expect(status().notice).toMatch(/Switched to/);
  });

  it("shows a model that can't load", async () => {
    await request({ type: "start", tabId: 7 });
    await event({ type: "model", tier: "ultralight", state: "error", error: "no WebAssembly" });
    expect(status().error).toBe("no WebAssembly");
  });

  it("ignores messages from other extensions and commands meant for the offscreen page", async () => {
    const respond = vi.fn();
    expect(h.listener!({ type: "signOut" }, { id: "evil" }, respond)).toBe(false);
    expect(h.listener!({ target: "offscreen", type: "stop" }, { id: "ext" }, respond)).toBe(false);
    expect(respond).not.toHaveBeenCalled();
    expect(h.local.has("sylence:auth")).toBe(true);
  });

  it("dismiss returns to idle", async () => {
    h.streamIdError = new Error("nope");
    await request({ type: "start", tabId: 7 });
    await request({ type: "dismiss" });
    expect(status().phase).toBe("idle");
  });

  describe("checking the session when the popup opens", () => {
    it("signs out an account the node no longer knows, and says why", async () => {
      node.signedOut = true;
      const r = await request({ type: "checkSession" });
      expect(r).toEqual({ ok: true, value: { signedIn: false } });
      expect(h.local.get("sylence:auth") ?? null).toBeNull();
      expect(h.session.get("sylence:signed-out-reason")).toMatch(/Sign in again/);
    });

    it("keeps a live session and unchooses a workspace that is gone", async () => {
      node.apps = [{ appId: "other", name: "Other", package: "com.calimero.sylence" }];
      const r = await request({ type: "checkSession" });
      expect(r).toEqual({ ok: true, value: { signedIn: true } });
      expect((h.local.get("sylence:auth") as AuthState).workspace).toBeNull();
    });

    it("keeps the workspace it still reaches", async () => {
      await request({ type: "checkSession" });
      expect((h.local.get("sylence:auth") as AuthState).workspace).toEqual(AUTH.workspace);
    });

    it("does not sign out when the node does not answer", async () => {
      node.offline = 1;
      const r = await request({ type: "checkSession" });
      expect(r).toEqual({ ok: true, value: { signedIn: true } });
      expect(h.local.get("sylence:auth")).toEqual(AUTH);
    });
  });

  describe("notes written by the model on this laptop", () => {
    // Smart notes are experimental and off by default: these turn them on.
    beforeEach(() => {
      h.local.set("sylence:settings", {
        tier: "auto",
        language: "en",
        mic: true,
        pageOverride: "",
        autoActions: true,
        smartNotes: true,
        notesModel: "auto",
        improveAfterCall: false,
      });
    });

    const gpu = (answer: (lines: { text: string }[]) => Event) => {
      h.offscreen = async (c) => {
        if (c.type === "caps") return { webgpu: true, deviceMemoryGb: 8, cores: 8, cached: ["light"] };
        if (c.type === "notes") {
          setTimeout(() => {
            void event({ type: "notesProgress", model: c.model, fraction: 0.5, step: "write" });
            void event(answer(c.lines));
          }, 0);
        }
        return true;
      };
    };
    const record = async (lines: string[]) => {
      await request({ type: "start", tabId: 7 });
      await event({ type: "model", tier: "light", state: "ready" });
      for (const [i, t] of lines.entries()) await event(segment(i % 2 ? "others" : "you", i * 3_000, t));
      await request({ type: "stop" });
      await event({ type: "drained", durationMs: 9_000 });
      await settle(80);
    };

    it("adds the model's summary and tasks, with owners and due dates", async () => {
      let asked: { text: string }[] = [];
      gpu((lines) => {
        asked = lines;
        return {
          type: "notes",
          notes: {
            summary: "The team reviewed the launch and agreed who writes the notes and tests Brave.",
            actions: [
              { text: "Write the release notes", assignee: "Ana", due: "Thursday" },
              { text: "Test Brave shields", assignee: "Marko", due: "today" },
            ],
          },
        } as Event;
      });
      await record(["Let's go through the launch.", "Ana will write the notes by Thursday and Marko tests Brave today."]);
      const notesCmd = h.toOffscreen.find((c) => c.type === "notes") as Extract<OffscreenCommand, { type: "notes" }>;
      // Automatic picks the 1.5B model on an 8 GB laptop with WebGPU.
      expect(notesCmd.model).toBe("better");
      expect(asked.map((l) => l.text)).toHaveLength(2);
      expect(node.actions.map((a) => [a.text, a.assignee])).toEqual([
        ["Write the release notes (by Thursday)", "Ana"],
        ["Test Brave shields (by today)", "Marko"],
      ]);
      expect(node.meetings.get("m1")!.summary).toMatch(/reviewed the launch/);
      const st = status();
      expect(st.phase).toBe("saved");
      expect(st.actions).toBe(2);
      expect(st.wroteSummary).toBe(true);
      expect(st.notesBy).toEqual({ kind: "model", model: "better" });
      expect(st.notes).toBeNull();
      expect(h.offscreenOpen).toBe(false);
    });

    it("falls back to phrase matching when the model fails", async () => {
      gpu(() => ({ type: "notesError", error: "WebGPU device lost" }) as Event);
      await record(["Ana, can you send the deck by Friday?", "Sure."]);
      expect(status().phase).toBe("saved");
      expect(node.actions.map((a) => a.text)).toEqual(["Send the deck by Friday"]);
      expect(status().wroteSummary).toBe(false);
      expect(status().notesBy).toEqual({ kind: "phrases", why: "The notes model failed: WebGPU device lost" });
      expect(logLines().some((l) => l.includes("phrase matching instead"))).toBe(true);
    });

    it("lets phrase matching look when the model finds no task", async () => {
      gpu(() => ({ type: "notes", notes: { summary: "Short.", actions: [] } }) as Event);
      await record(["Ana, can you send the deck by Friday?", "Sure."]);
      expect(node.actions.map((a) => a.text)).toEqual(["Send the deck by Friday"]);
      // One word is a title, not a summary.
      expect(node.meetings.get("m1")!.summary).toBe("");
    });

    it("never asks the model without WebGPU", async () => {
      await record(["Ana, can you send the deck by Friday?", "Sure."]);
      expect(h.toOffscreen.some((c) => c.type === "notes")).toBe(false);
      expect(node.actions).toHaveLength(1);
      expect(status().notesBy).toEqual({ kind: "phrases", why: "This browser doesn't offer WebGPU, which Smart notes need." });
    });
  });
});

describe("service worker: the transcript redone after the call", () => {
  const redo = (answer: (c: OffscreenCommand) => Event | null) => {
    h.offscreen = async (c) => {
      if (c.type === "caps") return { webgpu: true, deviceMemoryGb: 8, cores: 8, cached: ["best"] };
      const e = answer(c);
      if (e) {
        setTimeout(() => {
          void event({ type: "improveProgress", step: "transcribe", fraction: 0.5 });
          void event(e);
        }, 0);
      }
      return true;
    };
  };
  const record = async (lines: string[]) => {
    await request({ type: "start", tabId: 7 });
    await event({ type: "model", tier: "best", state: "ready" });
    for (const [i, t] of lines.entries()) await event(segment(i % 2 ? "others" : "you", i * 3_000, t));
    await request({ type: "stop" });
    await event({ type: "drained", durationMs: 9_000 });
    await settle(80);
  };

  it("replaces the live lines with the second pass, then finds action items in it", async () => {
    redo((c) =>
      c.type === "improve"
        ? ({
            type: "improved",
            startedAt: 0,
            lines: [
              { speaker: "others", startMs: 0, endMs: 2_000, text: "Ana, can you send the deck by Friday?" },
              { speaker: "you", startMs: 2_500, endMs: 4_000, text: "Sure, I will." },
            ],
          } as Event)
        : null,
    );
    await record(["Anna can you sand the deck", "sure"]);
    expect(h.toOffscreen.find((c) => c.type === "improve")).toEqual({ target: "offscreen", type: "improve", language: "en" });
    expect(node.texts("m1")).toEqual(["Ana, can you send the deck by Friday?", "Sure, I will."]);
    expect(node.dropCalls).toEqual([[0, 2]]);
    expect(node.actions.map((a) => a.text)).toEqual(["Send the deck by Friday"]);
    const st = status();
    expect(st.phase).toBe("saved");
    expect(st.improved).toEqual({ done: true });
    expect(st.improve).toBeNull();
  });

  it("keeps the live transcript when the second pass fails", async () => {
    redo((c) => (c.type === "improve" ? ({ type: "improveError", error: "WebGPU device lost" } as Event) : null));
    await record(["Ana, can you send the deck by Friday?", "Sure."]);
    expect(node.texts("m1")).toEqual(["Ana, can you send the deck by Friday?", "Sure."]);
    expect(node.dropCalls).toEqual([]);
    expect(status().improved).toEqual({ done: false, why: "The second pass failed: WebGPU device lost" });
    expect(node.actions.map((a) => a.text)).toEqual(["Send the deck by Friday"]);
  });

  it("drops what it sent when the upload fails halfway, and keeps the live lines", async () => {
    redo((c) => {
      if (c.type !== "improve") return null;
      const lines = Array.from({ length: 150 }, (_, i) => ({ speaker: "others", startMs: i * 1_000, endMs: i * 1_000 + 900, text: `line ${i}` }));
      return { type: "improved", startedAt: 0, lines } as Event;
    });
    type Append = ReturnType<FakeNode["app"]>["appendSegments"];
    let calls = 0;
    const realApp = node.app.bind(node);
    node.app = (id: string) => {
      const a = realApp(id);
      return {
        ...a,
        appendSegments: async (x: Parameters<Append>[0]) => {
          calls++;
          // The live upload and the first batch of the redo go through; the second batch never does.
          if (x.segments.some((s) => s.seq >= 102)) throw new Error("offline");
          return a.appendSegments(x);
        },
      };
    };
    await record(["one live line", "two live lines"]);
    expect(calls).toBeGreaterThan(2);
    expect(node.texts("m1")).toEqual(["one live line", "two live lines"]);
    expect(node.dropCalls).toEqual([[2, 0xffffffff]]);
    expect(status().improved).toEqual({ done: false, why: "The improved transcript couldn't be saved." });
  });

  it("does not try without WebGPU, or when turned off", async () => {
    await record(["Hello there everyone."]);
    expect(h.toOffscreen.some((c) => c.type === "improve")).toBe(false);
    expect(status().improved).toEqual({ done: false, why: "This browser doesn't offer WebGPU, which the second pass needs." });
  });

  it("is skipped when turned off", async () => {
    h.local.set("sylence:settings", { ...DEFAULT_SETTINGS, improveAfterCall: false });
    redo(() => null);
    await record(["Hello there everyone."]);
    expect(h.toOffscreen.some((c) => c.type === "improve")).toBe(false);
    expect(status().improved).toBeNull();
  });
});

describe("service worker: every kind of call", () => {
  const T0 = 2_000_000;
  const CALLS = [
    { url: "https://meet.google.com/abc-defg-hij", title: "Meet - Weekly sync", platform: "meet", meeting: "Weekly sync", reader: true },
    { url: "https://app.zoom.us/wc/81234567890/join", title: "Zoom Meeting", platform: "zoom", meeting: null, reader: true },
    { url: "https://us02web.zoom.us/j/81234567890", title: "Design review - Zoom", platform: "zoom", meeting: "Design review", reader: true },
    { url: "https://teams.microsoft.com/v2/#/meetup-join/19:abc", title: "Planning | Microsoft Teams", platform: "teams", meeting: "Planning", reader: true },
    { url: "https://teams.live.com/meet/9381234", title: "Microsoft Teams", platform: "teams", meeting: null, reader: true },
    { url: "https://meet.jit.si/SylenceStandup", title: "SylenceStandup | Jitsi Meet", platform: "other", meeting: "SylenceStandup | Jitsi Meet", reader: false },
    { url: "https://acme.webex.com/meet/ana", title: "Cisco Webex", platform: "other", meeting: "Cisco Webex", reader: false },
    { url: "https://whereby.com/acme-team", title: "acme-team | Whereby", platform: "other", meeting: "acme-team | Whereby", reader: false },
    { url: "https://app.slack.com/huddle/T01/C02", title: "Huddle in #general - Slack", platform: "other", meeting: "Huddle in #general - Slack", reader: false },
  ] as const;

  for (const call of CALLS) {
    it(`${call.platform}: ${new URL(call.url).hostname} records, names and saves`, async () => {
      h.tab = { url: call.url, title: call.title };
      await request({ type: "start", tabId: 7 });
      const m = node.meetings.get("m1")!;
      expect(m.platform).toBe(call.platform);
      if (call.meeting) expect(m.title).toBe(call.meeting);
      else expect(m.title.length).toBeGreaterThan(0);
      // The speaker reader goes only into the call sites it knows.
      expect(h.injected).toEqual(call.reader ? [7] : []);
      await event({ type: "model", tier: "light", state: "ready" });
      if (call.reader) await speakers(T0, ["Ana"], { participants: ["Ana", "Fran"], self: "Fran" });
      await event(segment("others", 0, "We should ship on Thursday.", T0));
      await event(segment("you", 3_000, "Agreed.", T0));
      const lines = [...m.segments.values()].sort((a, b) => a.seq - b.seq);
      expect(lines.map((l) => l.text)).toEqual(["We should ship on Thursday.", "Agreed."]);
      expect(lines.map((l) => l.name)).toEqual(call.reader ? ["Ana", "Fran"] : ["", ""]);
      await request({ type: "stop" });
      await event({ type: "drained", durationMs: 6_000 });
      await settle(40);
      expect(status().phase).toBe("saved");
      expect(m.ended).toBe(true);
    });
  }
});

describe("service worker: speaker names", () => {
  const T0 = 1_000_000;

  it("names each line after who the call page showed talking", async () => {
    await request({ type: "start", tabId: 7 });
    expect(h.injected).toEqual([7]);
    await event({ type: "model", tier: "light", state: "ready" });
    await speakers(T0, ["Ana"], { participants: ["Ana", "Marko", "Fran"], self: "Fran" });
    await speakers(T0 + 3_000, []);
    await speakers(T0 + 4_000, ["Marko"]);
    await speakers(T0 + 7_000, ["Fran"]);
    await event(segment("others", 0, "Hi, Ana here", T0));
    await event(segment("others", 4_100, "Marko speaking", T0));
    await event(segment("you", 7_200, "And me", T0));
    const lines = [...node.meetings.get("m1")!.segments.values()].sort((a, b) => a.seq - b.seq);
    expect(lines.map((l) => l.name)).toEqual(["Ana", "Marko", "Fran"]);
    expect(status().lines.map((l) => l.name)).toEqual(["Ana", "Marko", "Fran"]);
    expect(status().speakers).toMatchObject({ via: "meet-tiles", participants: 3, self: "Fran" });

    await request({ type: "stop" });
    await event({ type: "drained", durationMs: 9_000 });
    expect(h.tabMessages).toContainEqual({ tabId: 7, message: { target: "speakers", type: "stop" } });
  });

  it("ignores a reader in another tab, and leaves lines unnamed without one", async () => {
    await request({ type: "start", tabId: 7 });
    await event({ type: "model", tier: "light", state: "ready" });
    await speakers(T0, ["Eve"], { tab: 8 });
    await event(segment("others", 0, "Who am I", T0));
    expect([...node.meetings.get("m1")!.segments.values()][0]!.name).toBe("");
  });

  it("names nobody when speaker names are turned off", async () => {
    h.local.set("sylence:settings", { tier: "auto", language: "en", mic: true, pageOverride: "", autoActions: true, speakerNames: false });
    await request({ type: "start", tabId: 7 });
    expect(h.injected).toEqual([]);
    await event({ type: "model", tier: "light", state: "ready" });
    await speakers(T0, ["Ana"]);
    await event(segment("others", 0, "Hello", T0));
    expect([...node.meetings.get("m1")!.segments.values()][0]!.name).toBe("");
  });
});
