import { describe, expect, it, vi } from "vitest";

vi.mock("./calimero", () => ({
  connectEvents: { emit: vi.fn() },
  getClient: vi.fn(),
  setOnline: vi.fn(),
  useCalimero: () => ({ isAuthenticated: true }),
}));

import { indexOf, streamApp, v1Payload, type AppEvent } from "./events";
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
