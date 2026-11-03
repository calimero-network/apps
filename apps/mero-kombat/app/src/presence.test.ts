import { describe, expect, it, vi } from "vitest";
import type { CloudEvent } from "@calimero-network/mero-js";

import { decodeState, encodeState, presencePublisher, subscribePresence } from "./presence";

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("presence state", () => {
  it("round-trips a slice through the hex the node answers", () => {
    const slice = { v: 1, seat: "p1", x: 150.5, h: [[3, 1, 0]] };
    expect(decodeState(hex(encodeState(slice)))).toEqual(slice);
  });

  it("reads nothing from a retracted or malformed entry", () => {
    expect(decodeState(null)).toBeNull();
    expect(decodeState("abc")).toBeNull();
    expect(decodeState("zz")).toBeNull();
    expect(decodeState(hex(new TextEncoder().encode("{not json")))).toBeNull();
  });
});

describe("presencePublisher", () => {
  it("keeps one request in flight and only the newest slice behind it", async () => {
    const releases: Array<() => void> = [];
    const publishPresence = vi.fn(
      () => new Promise<void>((resolve) => releases.push(resolve)),
    );
    const sent = vi.fn();
    const send = presencePublisher({ publishPresence, presenceStream: vi.fn() }, "app-1", sent);
    send({ n: 1 });
    send({ n: 2 });
    send({ n: 3 });
    expect(publishPresence).toHaveBeenCalledTimes(1);
    releases[0]?.();
    await vi.waitFor(() => expect(publishPresence).toHaveBeenCalledTimes(2));
    const calls = publishPresence.mock.calls as unknown as Array<[string, number, Uint8Array]>;
    expect(calls.map(([app, seq, state]) => [app, seq, decodeState(hex(state))])).toEqual([
      ["app-1", 1, { n: 1 }],
      ["app-1", 2, { n: 3 }],
    ]);
    expect(sent).toHaveBeenCalledTimes(2);
  });
});

describe("subscribePresence", () => {
  it("decodes the snapshot and each change, skipping retractions", async () => {
    const state = (v: unknown) => hex(encodeState(v));
    async function* stream(): AsyncGenerator<CloudEvent> {
      yield {
        id: "1",
        kind: "snapshot",
        data: [{ account: "a", device: "d1", state: state({ seat: "p1", n: 1 }) }],
      };
      yield { id: "2", kind: "presence", data: { account: "b", device: "d2", state: null } };
      yield { id: "3", kind: "presence", data: { account: "b", device: "d2", state: state({ seat: "p2", n: 4 }) } };
    }
    const seen: unknown[] = [];
    const stop = subscribePresence({ publishPresence: vi.fn(), presenceStream: vi.fn(stream) }, "app-1", (v) =>
      seen.push(v),
    );
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(seen).toEqual([
      { seat: "p1", n: 1 },
      { seat: "p2", n: 4 },
    ]);
    stop();
  });
});
