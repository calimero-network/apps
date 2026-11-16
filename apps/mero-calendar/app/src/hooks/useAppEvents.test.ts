import { renderHook, waitFor } from "@testing-library/react";
import { CalimeroError, type CalimeroClient } from "@calimero-network/mero-js";
import { describe, expect, it, vi } from "vitest";

import { accessLost, changedBy, useAppEvents } from "./useAppEvents";

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
    renderHook(() =>
      useAppEvents({ events } as unknown as Pick<CalimeroClient, "events">, "cal-1", vi.fn(), vi.fn(), onLost),
    );
    await waitFor(() => expect(onLost).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(events).toHaveBeenCalledTimes(1);
  });
});
