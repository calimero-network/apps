import { describe, expect, it, vi } from "vitest";

import { GameClient } from "../src/net/client";
import type { GameEvent } from "../src/net/events";
import { withRoutes } from "@calimero-apps/connect/testing";

type Ev = { id: string; kind: string; data: unknown };

/** A client whose event streams are scripted: each `events()` call yields the next batch, then ends. */
function scripted(batches: Ev[][]) {
  const froms: number[] = [];
  const events = vi.fn((_app: string, from = 0, signal?: AbortSignal) => {
    froms.push(from);
    const batch = batches.shift();
    return (async function* () {
      if (!batch) {
        // No more scripted batches: stay open until aborted.
        await new Promise<void>((r) => signal?.addEventListener("abort", () => r()));
        return;
      }
      for (const e of batch) yield e;
    })();
  });
  const view = vi.fn().mockResolvedValue({ index: 10, result: { name: "w", seed: 1, createdAt: 2 } });
  return { client: withRoutes({ events, view, call: vi.fn() }), froms };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("GameClient", () => {
  it("is the signed-in account to the contract", async () => {
    const { client } = scripted([]);
    await expect(new GameClient(client, "w", "acct").resolveIdentity()).resolves.toBe("acct");
  });

  it("streams from just after the last read, and resumes after a drop from the last event seen", async () => {
    vi.useFakeTimers();
    try {
      const { client, froms } = scripted([[{ id: "12:0", kind: "TilesChanged", data: { account: "bob" } }]]);
      const gc = new GameClient(client, "w", "acct");
      expect(await gc.fetchWorldMeta()).toEqual({ name: "w", seed: 1, createdAt: 2 });

      const seen: GameEvent[] = [];
      const onReconnect = vi.fn();
      await gc.subscribe((e) => seen.push(e), onReconnect);
      await vi.advanceTimersByTimeAsync(0);
      expect(froms).toEqual([11]);
      expect(seen).toEqual([{ kind: "TilesChanged", value: "bob" }]);

      // The first stream ended (a drop): re-opened from index 13, and the caller re-reads.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(froms).toEqual([11, 13]);
      expect(onReconnect).toHaveBeenCalledTimes(1);
      gc.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops for good on close", async () => {
    const { client, froms } = scripted([]);
    const gc = new GameClient(client, "w", "acct");
    await gc.subscribe(() => {});
    await tick();
    gc.close();
    await new Promise((r) => setTimeout(r, 20));
    expect(froms).toEqual([1]);
  });
});
