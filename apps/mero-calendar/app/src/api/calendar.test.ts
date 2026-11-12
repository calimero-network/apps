import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppError } from "@calimero-network/mero-js";
import { describe, expect, it, vi } from "vitest";

import { MeroCalendarClient } from "../generated/client";
import { BOOKING_GUEST_METHODS, messageOf, toEvents, toMembers, updateArgs } from "./calendar";
import { withRoutes } from "@calimero-apps/connect/testing";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

describe("the booking link's key", () => {
  it("may call only methods the contract has", () => {
    for (const m of BOOKING_GUEST_METHODS) expect(abi.methods[m], m).toBeDefined();
  });
});

describe("the calendar through the generated client", () => {
  it("sends an update only the fields it names", async () => {
    const call = vi.fn().mockResolvedValue({ index: 2, result: "e1" });
    const after = vi.fn();
    const cal = new MeroCalendarClient(withRoutes({ call, view: vi.fn() }), "app-1", { after });
    expect(await cal.updateEvent({ eventId: "e1", eventData: updateArgs({ title: "New", peers: undefined }) })).toBe("e1");
    expect(call).toHaveBeenCalledWith("app-1", "updateEvent", { eventId: "e1", eventData: { title: "New" } });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("turns decimal strings back into numbers", async () => {
    const view = vi.fn().mockResolvedValue({
      index: 2,
      result: [{ id: "a", username: "Ann", joinedAt: "1783296000000", usernameUpdatedAt: "1783296000001" }],
    });
    const cal = new MeroCalendarClient(withRoutes({ call: vi.fn(), view }), "app-1");
    expect(toMembers(await cal.getMembers())).toEqual([
      { id: "a", username: "Ann", joinedAt: 1_783_296_000_000, usernameUpdatedAt: 1_783_296_000_001 },
    ]);
  });

  it("runs `after` when a request fails too", async () => {
    const after = vi.fn();
    const cal = new MeroCalendarClient(withRoutes({ call: vi.fn(), view: vi.fn().mockRejectedValue(new Error("boom")) }), "a", {
      after,
    });
    await expect(cal.getEvents().then(toEvents)).rejects.toThrow("boom");
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe("messageOf", () => {
  it("gives a typed contract error v1's message", () => {
    const err = (appCode: string, fields: Record<string, unknown> = {}) =>
      Object.assign(Object.create(AppError.prototype), { appCode, fields, message: appCode });
    expect(messageOf(err("Forbidden"))).toBe("operation forbidden");
    expect(messageOf(err("NotFound", { id: "booking link" }))).toBe("key not found: booking link");
    expect(messageOf(err("Invalid", { message: "username cannot be empty" }))).toBe("username cannot be empty");
    expect(messageOf(err("SlotUnavailable"))).toBe("that time is not available");
    expect(messageOf(new Error("plain"))).toBe("plain");
  });
});
