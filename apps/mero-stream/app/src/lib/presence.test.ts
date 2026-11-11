import { describe, expect, it, vi } from "vitest";
import { fromHex, presencePublisher, subscribePresence, toHex } from "./presence";
import { withRoutes } from "@calimero-apps/connect/testing";

describe("presence as a media pipe", () => {
  it("carries bytes as hex", () => {
    const bytes = Uint8Array.from([0, 1, 127, 128, 255]);
    expect(toHex(bytes)).toBe("00017f80ff");
    expect(fromHex(toHex(bytes))).toEqual(bytes);
    expect(fromHex("zz")).toBeNull();
    expect(fromHex(null)).toBeNull();
  });

  it("publishes with a seq that only grows, even across a reload", async () => {
    const publishPresence = vi.fn(async () => {});
    const send = presencePublisher(withRoutes({ publishPresence, presenceStream: vi.fn() }), "room");
    await send(Uint8Array.of(1));
    await send(Uint8Array.of(2));
    const seqs = publishPresence.mock.calls.map((c) => (c as unknown[])[1] as number);
    expect(seqs[1]).toBeGreaterThan(seqs[0]);
    expect(seqs[0]).toBeGreaterThanOrEqual(Date.now() * 1000 - 10_000_000);
    expect(publishPresence).toHaveBeenCalledWith("room", seqs[0], Uint8Array.of(1));
  });

  it("hands over live changes only, never the stale snapshot", async () => {
    const presenceStream = vi.fn(async function* () {
      yield { id: "0", kind: "snapshot", data: [{ account: "a", device: "d", state: "01" }] };
      yield { id: "1", kind: "presence", data: { account: "b", device: "d2", state: "0203" } };
      yield { id: "2", kind: "presence", data: { account: "b", device: "d2", state: null } };
    });
    const seen: unknown[] = [];
    subscribePresence(withRoutes({ presenceStream, publishPresence: vi.fn() }), "room", (u) => seen.push(u));
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(seen).toEqual([
      { account: "b", device: "d2", state: Uint8Array.of(2, 3) },
      { account: "b", device: "d2", state: null },
    ]);
  });
});
