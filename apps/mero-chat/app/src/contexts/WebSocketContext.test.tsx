import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";

import { setConnection } from "../calimero/connection";
import type { WebSocketEvent } from "../types/WebSocketTypes";
import { WebSocketProvider, toWebSocketEvent, useWebSocket, useWebSocketEvents, withSnakeKeys } from "./WebSocketContext";

afterEach(() => setConnection(null));

describe("events in v1's shape", () => {
  it("gives the contract's camelCase keys in snake_case too", () => {
    expect(withSnakeKeys({ messageId: "m", parentMessageId: "p" })).toEqual({
      messageId: "m",
      message_id: "m",
      parentMessageId: "p",
      parent_message_id: "p",
    });
    expect(withSnakeKeys(null)).toBeNull();
  });

  it("wraps one app event as a state mutation of that conversation", () => {
    expect(toWebSocketEvent("app-1", "MessageSent", { messageId: "m" })).toMatchObject({
      contextId: "app-1",
      type: "StateMutation",
      data: { events: [{ kind: "MessageSent", data: { messageId: "m", message_id: "m" } }] },
    });
  });
});

describe("WebSocketProvider", () => {
  it("streams a subscribed conversation from after what is committed, and delivers its events", async () => {
    const seen: WebSocketEvent[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const events = vi.fn(async function* () {
      yield { id: "8", kind: "MessageSent", data: { messageId: "m1" } };
      await gate;
    });
    setConnection({
      client: { view: vi.fn().mockResolvedValue({ index: 7, result: "0" }), events } as never,
      accountId: "me",
      source: "bundle",
      passkey: () => ({}) as never,
      after: () => {},
    });

    function Probe() {
      const ws = useWebSocket();
      useWebSocketEvents((e) => seen.push(e));
      useEffect(() => ws.subscribeToContext("app-1"), [ws]);
      return null;
    }

    const { unmount } = render(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(events).toHaveBeenCalledWith("app-1", 8, expect.anything());
    expect(seen).toHaveLength(1);
    expect(seen[0].contextId).toBe("app-1");
    unmount();
    release();
  });

  it("refuses use outside the provider", () => {
    function Bad() {
      useWebSocket();
      return null;
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bad />)).toThrow(/WebSocketProvider/);
  });
});
