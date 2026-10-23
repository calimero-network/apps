/**
 * Booking links: the URL a guest opens, and the two halves a link is made of
 * (the core access grant and the contract record) staying in step.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecuteTransport } from "@calimero-network/mero-js";

import { BOOKING_GUEST_METHODS, sha256Hex } from "./accessGrants";
import {
  bookingUrl,
  createBookingLink,
  deleteBookingLink,
  guest,
  parseBookingFragment,
} from "./booking";

const TOKEN = "ab".repeat(32);
const CTX = "c1".repeat(32);
const NODE = "https://node.example:2428";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function owner() {
  return { nodeUrl: NODE, token: () => "jwt", refresh: vi.fn(async () => undefined) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the booking URL", () => {
  it("round-trips through the fragment", () => {
    const url = bookingUrl("https://cal.example/", { nodeUrl: NODE, contextId: CTX, token: TOKEN });
    expect(url.startsWith("https://cal.example/book#")).toBe(true);
    expect(parseBookingFragment(new URL(url).hash)).toEqual({
      nodeUrl: NODE,
      contextId: CTX,
      token: TOKEN,
    });
  });

  it("refuses a fragment missing a part, a non-http node, or a malformed token", () => {
    expect(parseBookingFragment("#n=https://x&c=ctx")).toBeNull();
    expect(parseBookingFragment(`#n=javascript:alert(1)&c=ctx&t=${TOKEN}`)).toBeNull();
    expect(parseBookingFragment("#n=https://x&c=ctx&t=short")).toBeNull();
  });
});

describe("making and deleting a link", () => {
  it("issues a grant for exactly the guest methods and records its token's hash", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        data: { grantId: "g1", token: TOKEN, methods: [], label: "", createdAt: 1, notAfter: null },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const execute = vi.fn(async () => ({ linkId: "x" }));
    const rpc = { execute } as unknown as ExecuteTransport;

    const { url } = await createBookingLink(owner(), rpc, CTX, {
      title: "Intro",
      description: "",
      durationMinutes: 30,
      weeklyHours: [{ weekday: 0, startMinute: 540, endMinute: 1020 }],
      horizonDays: 14,
      minNoticeMinutes: 0,
    });

    const [grantUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(grantUrl).toBe(`${NODE}/admin-api/contexts/${CTX}/grants`);
    expect(JSON.parse(init.body as string).methods).toEqual([...BOOKING_GUEST_METHODS]);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt");

    const call = (execute.mock.calls[0] as unknown as [{ method: string; argsJson: { link: { tokenHash: string; grantId: string } } }])[0];
    expect(call.method).toBe("create_booking_link");
    expect(call.argsJson.link.tokenHash).toBe(await sha256Hex(TOKEN));
    expect(call.argsJson.link.grantId).toBe("g1");
    expect(parseBookingFragment(new URL(url).hash)?.token).toBe(TOKEN);
  });

  it("revokes the grant again when the contract refuses the link", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: { grantId: "g1", token: TOKEN, methods: [], label: "", createdAt: 1, notAfter: null },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { data: { grantId: "g1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const rpc = {
      execute: vi.fn(async () => {
        throw new Error("title cannot be empty");
      }),
    } as unknown as ExecuteTransport;

    await expect(
      createBookingLink(owner(), rpc, CTX, {
        title: "",
        description: "",
        durationMinutes: 30,
        weeklyHours: [],
        horizonDays: 14,
        minNoticeMinutes: 0,
      }),
    ).rejects.toThrow("title cannot be empty");
    const [revokeUrl, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(revokeUrl).toBe(`${NODE}/admin-api/contexts/${CTX}/grants/g1`);
    expect(init.method).toBe("DELETE");
  });

  it("retries once with a refreshed token after a 401", async () => {
    let token = "stale";
    const node = {
      nodeUrl: NODE,
      token: () => token,
      refresh: vi.fn(async () => {
        token = "fresh";
      }),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "expired" }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { grantId: "g1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const rpc = { execute: vi.fn(async () => null) } as unknown as ExecuteTransport;

    await deleteBookingLink(node, rpc, CTX, { linkId: "l1", grantId: "g1" });
    expect(node.refresh).toHaveBeenCalledOnce();
    const [, retry] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect((retry.headers as Record<string, string>).Authorization).toBe("Bearer fresh");
  });

  it("deletes the record even when the grant is already gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(404, { error: "no such access grant" })));
    const execute = vi.fn(async () => null);
    await deleteBookingLink(owner(), { execute } as unknown as ExecuteTransport, CTX, {
      linkId: "l1",
      grantId: "g1",
    });
    expect(execute).toHaveBeenCalledOnce();
  });
});

describe("the guest", () => {
  it("calls the grant route with no credential but the token, which it also passes to the method", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: { returns: [1, 2] } }));
    vi.stubGlobal("fetch", fetchMock);

    const slots = await guest.slots({ nodeUrl: NODE, contextId: CTX, token: TOKEN }, 10, 20);
    expect(slots).toEqual([1, 2]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${NODE}/admin-api/contexts/${CTX}/grant-calls`);
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({
      token: TOKEN,
      method: "get_available_slots",
      argsJson: { token: TOKEN, from_ms: 10, to_ms: 20 },
    });
  });

  it("surfaces the node's refusal text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(403, { error: "this access grant has expired" })),
    );
    await expect(guest.page({ nodeUrl: NODE, contextId: CTX, token: TOKEN })).rejects.toThrow(
      "this access grant has expired",
    );
  });
});
