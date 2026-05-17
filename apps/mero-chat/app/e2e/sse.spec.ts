/**
 * SSE subscription e2e tests — live merod node, no browser.
 *
 * Uses a thin fetch-based SSE listener that mirrors what SseSubscriptionsClient
 * does internally, so we can measure event latency without relying on
 * browser EventSource or localStorage for the access token.
 *
 * Prerequisites:
 *   ./scripts/dev-node.sh   ← builds WASM, starts node, writes app/.env.integration
 *
 * Run:
 *   pnpm exec playwright test --project=sse
 *   pnpm test:sse
 */

import { test, expect } from "@playwright/test";
import { envAvailable, getEnv, makeClient } from "./helpers/rpc-client";

// ── SseListener ───────────────────────────────────────────────────────────────

interface SseEvent {
  data: unknown;
  receivedAt: number;
}

interface ConnectPayload {
  type: "connect";
  session_id: string;
  reconnect: boolean;
}

interface StateMutationPayload {
  result?: {
    contextId: string;
    type: string;
    data: { events: unknown[] };
  };
}

/**
 * Lightweight SSE client that reads the event stream using Node's built-in
 * fetch (Node 18+) without browser EventSource or localStorage.
 */
class SseListener {
  private controller = new AbortController();
  private events: SseEvent[] = [];
  private sessionId: string | null = null;
  private streamDone = false;

  constructor(
    private readonly nodeUrl: string,
    private readonly token: string,
  ) {}

  async connect(): Promise<void> {
    const url = `${this.nodeUrl}/sse?token=${encodeURIComponent(this.token)}`;
    const res = await fetch(url, {
      signal: this.controller.signal,
      headers: { Accept: "text/event-stream" },
    });
    if (!res.ok || !res.body) {
      throw new Error(`SSE connect failed: ${res.status} ${res.statusText}`);
    }

    // Start consuming the stream in the background
    void this.readStream(res.body.getReader());

    // Block until we have a session_id (connect event)
    await this.waitForSession(8_000);
  }

  private async readStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!this.streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by blank lines (\n\n)
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.trim()) continue;
          const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const raw = dataLine.slice("data: ".length);
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            if (parsed.type === "connect") {
              this.sessionId = (parsed as unknown as ConnectPayload).session_id;
            }
            this.events.push({ data: parsed, receivedAt: performance.now() });
          } catch {
            // non-JSON line — skip
          }
        }
      }
    } catch {
      // AbortError or natural close — expected
    }
  }

  private async waitForSession(timeout: number): Promise<void> {
    const deadline = Date.now() + timeout;
    while (!this.sessionId) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for SSE session_id");
      await new Promise((r) => setTimeout(r, 30));
    }
  }

  async subscribe(contextIds: string[]): Promise<void> {
    if (!this.sessionId) throw new Error("Not connected — no session_id");
    const res = await fetch(`${this.nodeUrl}/sse/subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        id: this.sessionId,
        method: "subscribe",
        params: { contextIds },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`subscribe failed: ${res.status} ${body}`);
    }
  }

  async unsubscribe(contextIds: string[]): Promise<void> {
    if (!this.sessionId) return;
    await fetch(`${this.nodeUrl}/sse/subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        id: this.sessionId,
        method: "unsubscribe",
        params: { contextIds },
      }),
    });
  }

  /**
   * Wait until a matching event appears after this call's start cursor.
   * Pass `fromIndex` to search from a specific position (useful in loops).
   */
  async waitForEvent(
    predicate: (data: unknown) => boolean,
    timeout = 10_000,
    fromIndex = this.events.length,
  ): Promise<unknown> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const match = this.events.slice(fromIndex).find((e) => predicate(e.data));
      if (match) return match.data;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error("Timed out waiting for SSE event");
  }

  /** Current number of collected events — use as fromIndex before an RPC call. */
  getEventCount() { return this.events.length; }

  /** Collect any new events for `durationMs` ms and return them. */
  async collectFor(durationMs: number): Promise<SseEvent[]> {
    const start = this.events.length;
    await new Promise((r) => setTimeout(r, durationMs));
    return this.events.slice(start);
  }

  getSessionId() { return this.sessionId; }
  getEvents()    { return [...this.events]; }

  disconnect() {
    this.streamDone = true;
    this.controller.abort();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendMessageArgs(message: string) {
  return {
    message,
    mentions: [],
    mentions_usernames: [],
    parent_message: null,
    timestamp: Math.floor(Date.now() / 1000),
    sender_username: "sse-tester",
    files: null,
    images: null,
  };
}

// ── Skip guard ────────────────────────────────────────────────────────────────

function requireEnv() {
  if (!envAvailable()) test.skip();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("SSE — connect and session", () => {
  test.beforeAll(requireEnv);

  test("connects and receives a session_id", async () => {
    const env = getEnv();
    const sse = new SseListener(env.nodeUrl, env.accessToken);
    try {
      await sse.connect();
      expect(sse.getSessionId()).toBeTruthy();
      expect(typeof sse.getSessionId()).toBe("string");
    } finally {
      sse.disconnect();
    }
  });

  test("connect event carries reconnect=false on first connection", async () => {
    const env = getEnv();
    const sse = new SseListener(env.nodeUrl, env.accessToken);
    try {
      await sse.connect();
      const connectEvent = sse
        .getEvents()
        .find((e) => (e.data as Record<string, unknown>).type === "connect");
      expect(connectEvent).toBeDefined();
      expect((connectEvent!.data as ConnectPayload).reconnect).toBe(false);
    } finally {
      sse.disconnect();
    }
  });
});

test.describe("SSE — subscribe and receive events", () => {
  test.beforeAll(requireEnv);

  test("subscribes to a context and receives a StateMutation on RPC call", async () => {
    const env = getEnv();
    const client = makeClient();
    const sse = new SseListener(env.nodeUrl, env.accessToken);

    try {
      await sse.connect();
      await sse.subscribe([env.contextId]);

      const cursor = sse.getEventCount();
      const sentAt = performance.now();

      // Trigger a state-mutating RPC call — send_message produces StateMutation
      await client.call("send_message", sendMessageArgs(`sse-test-${Date.now()}`));

      const event = (await sse.waitForEvent(
        (d) =>
          (d as StateMutationPayload)?.result?.contextId === env.contextId &&
          (d as StateMutationPayload)?.result?.type === "StateMutation",
        10_000,
        cursor,
      )) as StateMutationPayload;

      const receivedAt = performance.now();
      const latencyMs = receivedAt - sentAt;

      expect(event.result?.contextId).toBe(env.contextId);
      expect(event.result?.type).toBe("StateMutation");
      expect(Array.isArray(event.result?.data.events)).toBe(true);
      expect(event.result!.data.events.length).toBeGreaterThan(0);

      // Log latency for visibility in the test report
      console.log(`SSE event latency: ${latencyMs.toFixed(1)} ms`);
      // Generous upper bound — local node should be well under 5 s
      expect(latencyMs).toBeLessThan(5_000);
    } finally {
      sse.disconnect();
    }
  });

  test("receives multiple events from multiple messages", async () => {
    const env = getEnv();
    const client = makeClient();
    const sse = new SseListener(env.nodeUrl, env.accessToken);

    try {
      await sse.connect();
      await sse.subscribe([env.contextId]);

      const tag = `batch-${Date.now()}`;
      await client.call("send_message", sendMessageArgs(`${tag}-1`));
      await client.call("send_message", sendMessageArgs(`${tag}-2`));
      await client.call("send_message", sendMessageArgs(`${tag}-3`));

      // Wait for at least 3 StateMutation events (there may be more from earlier calls)
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const mutations = sse
          .getEvents()
          .filter(
            (e) =>
              (e.data as StateMutationPayload)?.result?.contextId === env.contextId &&
              (e.data as StateMutationPayload)?.result?.type === "StateMutation",
          );
        if (mutations.length >= 3) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      const mutations = sse
        .getEvents()
        .filter(
          (e) =>
            (e.data as StateMutationPayload)?.result?.contextId === env.contextId &&
            (e.data as StateMutationPayload)?.result?.type === "StateMutation",
        );
      expect(mutations.length).toBeGreaterThanOrEqual(3);
    } finally {
      sse.disconnect();
    }
  });
});

test.describe("SSE — unsubscribe stops events", () => {
  test.beforeAll(requireEnv);

  test("events stop arriving after unsubscribe", async () => {
    const env = getEnv();
    const client = makeClient();
    const sse = new SseListener(env.nodeUrl, env.accessToken);

    try {
      await sse.connect();
      await sse.subscribe([env.contextId]);

      // Confirm we can receive events before unsubscribing
      const cursorPre = sse.getEventCount();
      await client.call("send_message", sendMessageArgs(`pre-unsub-${Date.now()}`));
      await sse.waitForEvent(
        (d) => (d as StateMutationPayload)?.result?.type === "StateMutation",
        8_000,
        cursorPre,
      );

      // Unsubscribe and wait a moment for the server to process it
      await sse.unsubscribe([env.contextId]);
      await new Promise((r) => setTimeout(r, 300));

      const before = sse.getEvents().length;

      // Send two more messages — they should NOT arrive on the SSE stream
      await client.call("send_message", sendMessageArgs(`post-unsub-1-${Date.now()}`));
      await client.call("send_message", sendMessageArgs(`post-unsub-2-${Date.now()}`));

      // Wait 1 s — if events were going to arrive, they'd arrive within this window
      const newEvents = await sse.collectFor(1_000);
      const mutations = newEvents.filter(
        (e) =>
          (e.data as StateMutationPayload)?.result?.contextId === env.contextId &&
          (e.data as StateMutationPayload)?.result?.type === "StateMutation",
      );

      console.log(`Events after unsubscribe: ${mutations.length} (${before} before)`);
      expect(mutations.length).toBe(0);
    } finally {
      sse.disconnect();
    }
  });
});

test.describe("SSE — latency measurements", () => {
  test.beforeAll(requireEnv);

  test("measures p50/p95 latency over 5 rapid RPC calls", async () => {
    const env = getEnv();
    const client = makeClient();
    const sse = new SseListener(env.nodeUrl, env.accessToken);

    try {
      await sse.connect();
      await sse.subscribe([env.contextId]);

      const N = 5;
      const latencies: number[] = [];

      for (let i = 0; i < N; i++) {
        const cursor = sse.getEventCount();
        const sentAt = performance.now();
        await client.call("send_message", sendMessageArgs(`latency-probe-${i}-${Date.now()}`));
        await sse.waitForEvent(
          (d) => (d as StateMutationPayload)?.result?.type === "StateMutation",
          8_000,
          cursor,
        );
        latencies.push(performance.now() - sentAt);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(N * 0.5)];
      const p95 = latencies[Math.floor(N * 0.95)] ?? latencies[N - 1];

      console.log(
        `SSE latency over ${N} calls — ` +
          `min: ${latencies[0].toFixed(0)} ms, ` +
          `p50: ${p50.toFixed(0)} ms, ` +
          `p95: ${p95.toFixed(0)} ms, ` +
          `max: ${latencies[N - 1].toFixed(0)} ms`,
      );

      // All events must arrive within 5 s on a local node
      expect(latencies[N - 1]).toBeLessThan(5_000);
    } finally {
      sse.disconnect();
    }
  });
});
