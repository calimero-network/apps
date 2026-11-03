import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginRequired, type CloudEvent } from "@calimero-network/mero-js";

import { GameClient } from "../src/net/client";
import type { GameEvent } from "../src/net/sync";

afterEach(() => vi.useRealTimers());

/** An `events` that serves `batches` one stream at a time, then ends (or throws). */
function fakeEvents(batches: (CloudEvent[] | Error)[]) {
  const froms: number[] = [];
  const events = vi.fn((_app: string, from = 0, signal?: AbortSignal) => {
    froms.push(from);
    const batch = batches.shift() ?? [];
    return (async function* () {
      if (batch instanceof Error) throw batch;
      for (const ev of batch) yield ev;
      // an open stream that never sends again until aborted
      if (batches.length === 0) await new Promise((r) => signal?.addEventListener("abort", r));
    })();
  });
  return { events, froms };
}

const ev = (id: number, kind: string, data: unknown): CloudEvent => ({ id: String(id), kind, data });

describe("GameClient events", () => {
  it("delivers events from the index it is given and resumes after the last seen", async () => {
    vi.useFakeTimers();
    const { events, froms } = fakeEvents([
      [ev(10, "BlocksChanged", { id: "a" }), ev(11, "PlayerJoined", { id: "b" })],
      [ev(12, "PlayerLeft", { id: "b" })],
    ]);
    const client = new GameClient({ call: vi.fn(), view: vi.fn(), events } as never, "app", "dev");
    const got: GameEvent[] = [];
    const reconnects = vi.fn();
    client.subscribe(10, (e) => got.push(e), reconnects);
    await vi.advanceTimersByTimeAsync(2000);
    expect(froms).toEqual([10, 12]);
    expect(reconnects).toHaveBeenCalledTimes(1);
    expect(got).toEqual([
      { kind: "BlocksChanged", value: { id: "a" } },
      { kind: "PlayerJoined", value: { id: "b" } },
      { kind: "PlayerLeft", value: { id: "b" } },
    ]);
    client.close();
  });

  it("stops and says so when the session is gone", async () => {
    vi.useFakeTimers();
    const { events } = fakeEvents([new LoginRequired("sign in")]);
    const onSignedOut = vi.fn();
    const client = new GameClient({ call: vi.fn(), view: vi.fn(), events } as never, "app", "dev", { onSignedOut });
    client.subscribe(1, () => {});
    await vi.advanceTimersByTimeAsync(5000);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(events).toHaveBeenCalledTimes(1);
  });

  it("retries a stream that failed for any other reason", async () => {
    vi.useFakeTimers();
    const { events } = fakeEvents([new Error("reset"), []]);
    const client = new GameClient({ call: vi.fn(), view: vi.fn(), events } as never, "app", "dev");
    client.subscribe(5, () => {});
    await vi.advanceTimersByTimeAsync(2000);
    expect(events).toHaveBeenCalledTimes(2);
    client.close();
  });
});
