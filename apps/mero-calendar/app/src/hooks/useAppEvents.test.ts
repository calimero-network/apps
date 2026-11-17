import { renderHook, waitFor } from "@testing-library/react";
import { CalimeroError } from "@calimero-network/mero-js";
import { describe, expect, it, vi } from "vitest";

import { accessLost, changedBy, indexOf, useAppEvents } from "./useAppEvents";

describe("indexOf", () => {
  it("reads the log index from an event id", () => {
    expect(indexOf("12:3")).toBe(12);
    expect(indexOf("5")).toBe(5);
    expect(indexOf("x")).toBeNull();
  });
});

describe("changedBy", () => {
  it("re-reads only what an event changed", () => {
    expect(changedBy("CalendarEventCreated")).toEqual({ events: true, members: false });
    expect(changedBy("CalendarEventDeleted")).toEqual({ events: true, members: false });
    expect(changedBy("MemberUsernameUpdated")).toEqual({ events: false, members: true });
    expect(changedBy("MemberJoined")).toEqual({ events: false, members: true });
  });

  it("re-reads both after a reconnect or an unknown kind", () => {
    expect(changedBy(null)).toEqual({ events: true, members: true });
    expect(changedBy("SomethingNew")).toEqual({ events: true, members: true });
  });
});

describe("useAppEvents", () => {
  it("a refused stream (403, 404) is access lost", () => {
    expect(accessLost(new CalimeroError(403, "FORBIDDEN", "not a member"))).toBe(true);
    expect(accessLost(new CalimeroError(404, "NOT_FOUND", "no such app"))).toBe(true);
    expect(accessLost(new CalimeroError(500, "INTERNAL", "boom"))).toBe(false);
    expect(accessLost(new Error("network"))).toBe(false);
  });

  it("stops following and calls onLost once access is lost, instead of retrying", async () => {
    const events = vi.fn(() =>
      (async function* () {
        yield* [];
        throw new CalimeroError(403, "FORBIDDEN", "not a member");
      })(),
    );
    const onLost = vi.fn();
    renderHook(() => useAppEvents(fake(events), "cal-1", vi.fn(), vi.fn(), onLost));
    await waitFor(() => expect(onLost).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(events).toHaveBeenCalledTimes(1);
  });

  it("starts after the log's head, not at its start, and resumes after the last event seen", async () => {
    let opened = 0;
    const events = vi.fn((_app: string, _from?: number) =>
      (async function* () {
        opened += 1;
        if (opened === 1) {
          yield { id: "8:0", kind: "CalendarEventCreated", data: {} };
          throw new Error("dropped");
        }
        await new Promise(() => {});
      })(),
    );
    const onEvent = vi.fn();
    const view = vi.fn(async () => ({ result: [], index: 7 }));
    const { unmount } = renderHook(() => useAppEvents(fake(events, view), "cal-1", onEvent));
    await waitFor(() => expect(events).toHaveBeenCalledTimes(2), { timeout: 4_000 });
    expect(events.mock.calls[0]![1]).toBe(8);
    expect(events.mock.calls[1]![1]).toBe(9);
    expect(view).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith("CalendarEventCreated", {});
    unmount();
  });
});

function fake(events: unknown, view: unknown = vi.fn(async () => ({ result: [], index: 0 }))) {
  return { events, apps: { view } } as unknown as Parameters<typeof useAppEvents>[0];
}
