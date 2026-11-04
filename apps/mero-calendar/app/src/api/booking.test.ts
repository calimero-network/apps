/**
 * Booking links: the URL a guest opens, and the two halves a link is made of
 * (a core API key and the contract record) staying in step.
 */
import { describe, expect, it, vi } from "vitest";

import { BOOKING_GUEST_METHODS } from "./calendar";
import {
  bookingUrl,
  createBookingLink,
  deleteBookingLink,
  guest,
  guestCalendar,
  parseBookingFragment,
  sha256Hex,
  type Owner,
} from "./booking";

const APP = "app-1";
const KEY = "mk_live_secret";

describe("the booking URL", () => {
  it("round-trips through the fragment", () => {
    const url = bookingUrl("https://cal.example/", { app: APP, token: KEY });
    expect(url.startsWith("https://cal.example/book#")).toBe(true);
    expect(parseBookingFragment(new URL(url).hash)).toEqual({ app: APP, token: KEY });
  });

  it("names nothing when a part is missing", () => {
    expect(parseBookingFragment("#a=app-1")).toBeNull();
    expect(parseBookingFragment("#t=x")).toBeNull();
    expect(parseBookingFragment("")).toBeNull();
  });
});

function owner(call = vi.fn()): Owner & { client: Record<string, ReturnType<typeof vi.fn>> } {
  return {
    client: {
      createApiKey: vi.fn(async () => ({ keyId: "key-1", key: KEY })),
      revokeApiKey: vi.fn(async () => undefined),
      call,
      view: vi.fn(async () => ({ index: 1, result: [] })),
    },
    app: APP,
    passkey: () => ({}) as never,
  } as never;
}

const link = {
  title: "Intro call",
  description: "",
  durationMinutes: 30,
  weeklyHours: [{ weekday: 0, startMinute: 540, endMinute: 660 }],
  horizonDays: 14,
  minNoticeMinutes: 0,
};

describe("making a link", () => {
  it("creates an API key for the five guest methods of this calendar, then records the link under its hash", async () => {
    const call = vi.fn(async () => ({
      index: 2,
      result: { linkId: "h", grantId: "key-1", createdAtMs: "1783296000000", expiresAtMs: null, status: "open" },
    }));
    const o = owner(call);
    const { link: made, url } = await createBookingLink(o, link, "https://cal.example");

    expect(o.client.createApiKey).toHaveBeenCalledWith(
      { label: "Booking link: Intro call", apps: [APP], methods: [...BOOKING_GUEST_METHODS] },
      expect.anything(),
    );
    const [, method, args] = call.mock.calls[0] as unknown as [string, string, { link: Record<string, unknown> }];
    expect(method).toBe("createBookingLink");
    expect(args.link.tokenHash).toBe(await sha256Hex(KEY));
    expect(args.link.grantId).toBe("key-1");
    expect(args.link.expiresAtMs).toBeNull();
    // u64s come back as numbers.
    expect(made.createdAtMs).toBe(1_783_296_000_000);
    expect(parseBookingFragment(new URL(url).hash)).toEqual({ app: APP, token: KEY });
  });

  it("limits the key's life to the link's expiry, sent as a decimal string", async () => {
    const call = vi.fn(async () => ({ index: 2, result: {} }));
    const o = owner(call);
    const now = 1_000_000;
    await createBookingLink(o, { ...link, expiresAtMs: now + 3_600_000 }, "https://x", now);
    expect(o.client.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ ttlSecs: 3600 }),
      expect.anything(),
    );
    const args = (call.mock.calls[0] as unknown as [string, string, { link: Record<string, unknown> }])[2];
    expect(args.link.expiresAtMs).toBe(String(now + 3_600_000));
  });

  it("revokes the key again when the contract refuses the link", async () => {
    const o = owner(vi.fn(async () => Promise.reject(new Error("refused"))));
    await expect(createBookingLink(o, link, "https://x")).rejects.toThrow("refused");
    expect(o.client.revokeApiKey).toHaveBeenCalledWith("key-1", expect.anything());
  });
});

describe("deleting a link", () => {
  it("revokes its key, then deletes the record", async () => {
    const call = vi.fn(async () => ({ index: 3, result: "h" }));
    const o = owner(call);
    await deleteBookingLink(o, { linkId: "h", grantId: "key-1" });
    expect(o.client.revokeApiKey).toHaveBeenCalledWith("key-1", expect.anything());
    expect(call).toHaveBeenCalledWith(APP, "deleteBookingLink", { linkId: "h" });
  });

  it("goes on when the key is already gone", async () => {
    const call = vi.fn(async () => ({ index: 3, result: "h" }));
    const o = owner(call);
    o.client.revokeApiKey.mockRejectedValueOnce(Object.assign(new Error("gone"), { status: 404 }));
    await deleteBookingLink(o, { linkId: "h", grantId: "key-1" });
    expect(call).toHaveBeenCalled();
  });
});

describe("the guest", () => {
  it("calls with the link's key and passes the token, times as decimal strings", async () => {
    const useApiKey = vi.fn();
    const call = vi.fn(async () => ({ index: 1, result: { startMs: "5", endMs: "6" } }));
    const view = vi.fn(async () => ({ index: 1, result: ["1783296000000"] }));
    const target = { app: APP, token: KEY };
    const cal = guestCalendar({ useApiKey, call, view } as never, target);
    expect(useApiKey).toHaveBeenCalledWith(KEY);

    expect(await guest.slots(cal, target, 1, 2)).toEqual([1_783_296_000_000]);
    expect(view).toHaveBeenCalledWith(APP, "getAvailableSlots", { token: KEY, fromMs: "1", toMs: "2" });
    const booked = await guest.book(cal, target, 5, { name: "G", email: "g@x", note: "" });
    expect(booked.startMs).toBe(5);
    expect(call).toHaveBeenCalledWith(APP, "bookSlot", {
      token: KEY,
      startMs: "5",
      guest: { name: "G", email: "g@x", note: "" },
    });
  });
});
