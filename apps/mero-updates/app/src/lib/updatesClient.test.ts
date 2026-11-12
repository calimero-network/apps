import { describe, expect, it, vi } from "vitest";

import { MeroUpdatesClient } from "../generated/client";
import { fromWire, toWire, toWireInput, u64 } from "./updatesClient";
import { withRoutes } from "@calimero-apps/connect/testing";

function recorder() {
  const sent: { kind: "call" | "view"; method: string; args: Record<string, unknown> }[] = [];
  const transport = withRoutes({
    call: vi.fn(async (_app: string, method: string, args?: unknown) => {
      sent.push({ kind: "call", method, args: args as Record<string, unknown> });
      return { index: 1, result: null, events: [] };
    }),
    view: vi.fn(async (_app: string, method: string, args?: unknown) => {
      sent.push({ kind: "view", method, args: args as Record<string, unknown> });
      return { index: 1, result: null };
    }),
  });
  return { sent, transport };
}

const input = {
  title: "June",
  summary: "",
  category_id: "",
  sections: [],
  metrics: [],
  asks: [{ id: null, kind: "intro", title: "x", detail: "" }],
};

describe("the contract's methods, through the generated client", () => {
  it("sends nested input in camelCase and a u64 argument as a decimal string", async () => {
    const { sent, transport } = recorder();
    const c = new MeroUpdatesClient(withRoutes(transport), "app-1");
    await c.publishUpdate({ input: toWireInput(input) });
    await c.listContributions({ since: u64(1_700_000_000_000) });
    expect(sent[0].args).toEqual({
      input: {
        title: "June",
        summary: "",
        categoryId: "",
        sections: [],
        metrics: [],
        asks: [{ id: null, kind: "intro", title: "x", detail: "" }],
      },
    });
    expect(sent[1].args).toEqual({ since: "1700000000000" });
  });

  it("keeps the stored session current after every request, failed ones too", async () => {
    const after = vi.fn();
    const transport = withRoutes({
      call: vi.fn(async () => {
        throw new Error("Forbidden");
      }),
      view: vi.fn(async () => ({ index: 1, result: { account: "a" } })),
    });
    const c = new MeroUpdatesClient(withRoutes(transport), "app-1", { after });
    await c.getMe();
    await expect(c.setProfile({ name: "n", firm: "" })).rejects.toThrow("Forbidden");
    expect(after).toHaveBeenCalledTimes(2);
  });
});

describe("answers", () => {
  it("come back in the screens' shapes: snake_case, u64 strings as numbers", () => {
    const card = fromWire<Record<string, unknown>>({
      id: "123",
      authorIsTeam: true,
      categoryId: "456",
      createdAt: "1700000000000",
      commentCount: "3",
      reactions: [{ emoji: "👍", count: "2", mine: false }],
      readByMe: false,
    });
    expect(card).toEqual({
      id: "123",
      author_is_team: true,
      category_id: "456",
      created_at: 1_700_000_000_000,
      comment_count: 3,
      reactions: [{ emoji: "👍", count: 2, mine: false }],
      read_by_me: false,
    });
  });

  it("leave strings that are not counts or times alone", () => {
    const post = fromWire<{ metrics: { value: string }[]; card: { id: string } }>({
      metrics: [{ name: "Customers", value: "12", unit: "" }],
      card: { id: "42" },
    });
    expect(post.metrics[0].value).toBe("12");
    expect(post.card.id).toBe("42");
  });

  it("read an engagement row's counts, a person's counts and the overview", () => {
    expect(fromWire({ reactions: "4", comments: "1", offers: "0", notRead: [] })).toEqual({
      reactions: 4,
      comments: 1,
      offers: 0,
      not_read: [],
    });
    expect(fromWire({ updatesRead: "1", acceptedOffers: "2", lastReadAt: "0" })).toEqual({
      updates_read: 1,
      accepted_offers: 2,
      last_read_at: 0,
    });
    expect(fromWire({ companyName: "Acme", cadenceDays: 30, nextDueAt: "5", isTeam: true })).toEqual({
      company_name: "Acme",
      cadence_days: 30,
      next_due_at: 5,
      is_team: true,
    });
  });

  it("toWire renames keys at every level, leaving values alone", () => {
    expect(toWire({ category_ids: ["a_b"], input: { asks: [{ id: null }] } })).toEqual({
      categoryIds: ["a_b"],
      input: { asks: [{ id: null }] },
    });
  });
});
