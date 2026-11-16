import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("./calimero", () => ({
  connectEvents: { emit: vi.fn() },
  getClient: vi.fn(),
  setOnline: vi.fn(),
  useCalimero: () => ({ isAuthenticated: true }),
}));

import { MAX_STREAMS, indexOf, streamApp, useAppEvents, v1Payload, type AppEvent } from "./events";
import { getClient } from "./calimero";
import { bytesParser } from "../utils/bytesParser";
import { withRoutes } from "@calimero-apps/connect/testing";

describe("v1Payload", () => {
  it("puts each event's data back in the shape the handlers decode", () => {
    expect(JSON.parse(bytesParser(v1Payload("MessageSent", { messageId: "m1" })))).toEqual({ message_id: "m1" });
    expect(JSON.parse(bytesParser(v1Payload("MessageEdited", { messageId: "m1" })))).toBe("m1");
    expect(JSON.parse(bytesParser(v1Payload("ReactionUpdated", { messageId: "m1" })))).toBe("m1");
    expect(JSON.parse(bytesParser(v1Payload("ProfileUpdated", { account: "a" })))).toBe("a");
    expect(JSON.parse(bytesParser(v1Payload("RoleUpdated", { account: "a" })))).toBe("a");
    expect(v1Payload("InfoUpdated", null)).toBeUndefined();
  });

  it("reads the log index out of an event id", () => {
    expect(indexOf("12:0")).toBe(12);
    expect(indexOf("x")).toBeNull();
  });
});

describe("streamApp", () => {
  it("starts after the app's current index and passes each event on", async () => {
    const ctrl = new AbortController();
    const seen: AppEvent[] = [];
    const client = withRoutes({
      view: vi.fn().mockResolvedValue({ index: 41, result: "0" }),
      events: vi.fn(async function* () {
        yield { id: "42:0", kind: "MessageSent", data: { messageId: "m1" } };
        ctrl.abort();
      }),
    });
    await streamApp(client as never, "app-1", (e) => seen.push(e), ctrl.signal);
    expect(client.events).toHaveBeenCalledWith("app-1", 42, ctrl.signal);
    expect(seen).toEqual([{ app: "app-1", kind: "MessageSent", data: JSON.stringify({ message_id: "m1" }) }]);
  });
});

describe("useAppEvents", () => {
  it("streams only the first apps and checks the rest for new messages", async () => {
    const view = vi.fn(async (_app: string) => ({ index: 5, result: "0" }));
    const events = vi.fn((_app: string, _from: number, signal: AbortSignal) =>
      (async function* () {
        await new Promise((resolve) => signal.addEventListener("abort", resolve));
        yield* [];
      })(),
    );
    const client = withRoutes({ view, events });
    vi.mocked(getClient).mockReturnValue(client as never);
    const seen: AppEvent[] = [];
    const apps = ["open", "b", "c", "d", "e"];
    const { unmount } = renderHook(() => useAppEvents(apps, (e) => seen.push(e)));
    await waitFor(() => expect(events).toHaveBeenCalledTimes(MAX_STREAMS));
    expect(events.mock.calls.map((c) => c[0])).toEqual(["open", "b", "c"]);
    // The others are read once for their head (no event yet).
    await waitFor(() => expect(view.mock.calls.map((c) => c[0])).toContain("e"));
    expect(seen).toEqual([]);
    unmount();
  });
});
