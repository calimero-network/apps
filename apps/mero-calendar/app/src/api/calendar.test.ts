import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppError } from "@calimero-network/mero-js";
import { describe, expect, it, vi } from "vitest";

import { BOOKING_GUEST_METHODS, CALLS, VIEWS, calendar, messageOf } from "./calendar";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

const event = {
  title: "t",
  description: "d",
  start: "s",
  end: "e",
  event_type: "event",
  color: "c",
  peers: ["bob"],
};

describe("the client covers the contract", () => {
  it("calls exactly the contract's calls, and views exactly its views", () => {
    expect([...CALLS].sort()).toEqual(byKind("call"));
    expect([...VIEWS].sort()).toEqual(byKind("view"));
    expect(byKind("init")).toEqual(["init"]);
    for (const m of BOOKING_GUEST_METHODS) expect(abi.methods[m], m).toBeDefined();
  });

  it("sends each method the parameter names the ABI declares", async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      return Promise.resolve({ index: 1, result: method.startsWith("get") || method.startsWith("list") ? [] : {} });
    };
    const cal = calendar({ call: vi.fn(record), view: vi.fn(record) }, "app-1");
    const guest = { name: "g", email: "g@x", note: "" };
    await Promise.all([
      cal.setUsername("a"),
      cal.getMembers(),
      cal.getEvents(),
      cal.getPrivateEvents(),
      cal.createEvent(event),
      cal.createPrivateEvent(event),
      cal.updateEvent("e", { title: "x" }),
      cal.updatePrivateEvent("e", { title: "x" }),
      cal.deleteEvent("e"),
      cal.deletePrivateEvent("e"),
      cal.createBookingLink({
        tokenHash: "h",
        grantId: "k",
        title: "t",
        description: "",
        durationMinutes: 30,
        weeklyHours: [],
        utcOffsetMinutes: 0,
        horizonDays: 1,
        minNoticeMinutes: 0,
        expiresAtMs: null,
      }),
      cal.listBookingLinks(),
      cal.deleteBookingLink("l"),
      cal.getBookingPage("t"),
      cal.getAvailableSlots("t", 0, 1),
      cal.bookSlot("t", 1, guest),
      cal.rescheduleBooking("t", 1),
      cal.cancelBooking("t"),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === "init") continue;
      expect(sent.get(name), name).toEqual(method.params.map(([p]) => p).sort());
    }
  });
});

describe("calendar", () => {
  it("sends an update only the fields it names", async () => {
    const call = vi.fn().mockResolvedValue({ index: 2, result: "e1" });
    const after = vi.fn();
    const cal = calendar({ call, view: vi.fn() }, "app-1", after);
    expect(await cal.updateEvent("e1", { title: "New", peers: undefined })).toBe("e1");
    expect(call).toHaveBeenCalledWith("app-1", "updateEvent", { eventId: "e1", eventData: { title: "New" } });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("turns decimal strings back into numbers", async () => {
    const view = vi.fn().mockResolvedValue({
      index: 2,
      result: [{ id: "a", username: "Ann", joinedAt: "1783296000000", usernameUpdatedAt: "1783296000001" }],
    });
    const cal = calendar({ call: vi.fn(), view }, "app-1");
    expect(await cal.getMembers()).toEqual([
      { id: "a", username: "Ann", joinedAt: 1_783_296_000_000, usernameUpdatedAt: 1_783_296_000_001 },
    ]);
  });

  it("runs `after` when a request fails too", async () => {
    const after = vi.fn();
    const cal = calendar({ call: vi.fn(), view: vi.fn().mockRejectedValue(new Error("boom")) }, "a", after);
    await expect(cal.getEvents()).rejects.toThrow("boom");
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
