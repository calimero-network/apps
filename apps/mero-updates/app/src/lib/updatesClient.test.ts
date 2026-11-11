import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CALLS, UpdatesClient, VIEWS, fromWire, toWire } from "./updatesClient";
import { withRoutes } from "@calimero-apps/connect/testing";

/** The committed ABI of the contract (`mero-component build` writes it). */
const abi = JSON.parse(
  readFileSync(resolve(process.cwd(), "../logic/res/abi.json"), "utf8"),
) as { methods: Record<string, { kind: string; params: [string, string][] }> };

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

/** One invocation of every method, with every argument the screens pass. */
async function callEverything(c: UpdatesClient) {
  await c.getMe();
  await c.getOverview();
  await c.getSettings();
  await c.getEngagement();
  await c.getPost({ post_id: "p" });
  await c.listAsks({ status: null });
  await c.listCategories();
  await c.listComments({ post_id: "p" });
  await c.listContributions({ since: 0 });
  await c.listDrafts();
  await c.listMetrics();
  await c.listPeople();
  await c.listPosts({ kind: null, category_id: null, cursor: null, limit: 20 });
  await c.addComment({ post_id: "p", parent_id: null, body: "b" });
  await c.addTeammate({ account: "a" });
  await c.archiveCategory({ category_id: "c" });
  await c.askQuestion({ title: "t", body: "", category_id: null });
  await c.createCategory({ name: "n", emoji: "", color: "" });
  await c.deleteComment({ comment_id: "c" });
  await c.deleteDraft({ draft_id: "d" });
  await c.deletePost({ post_id: "p" });
  await c.editCategory({ category_id: "c", name: "n", emoji: "", color: "" });
  await c.editComment({ comment_id: "c", body: "b" });
  await c.editUpdate({ post_id: "p", input });
  await c.markRead({ post_id: "p" });
  await c.offerHelp({ ask_id: "a", note: "" });
  await c.publishUpdate({ input });
  await c.react({ post_id: "p", emoji: "👍", on: true });
  await c.removeTeammate({ account: "a" });
  await c.saveDraft({ draft_id: null, title: "t", payload: "{}" });
  await c.setAskStatus({ ask_id: "a", status: "open" });
  await c.setMutedCategories({ category_ids: [] });
  await c.setOfferStatus({ ask_id: "a", account: "b", status: "accepted" });
  await c.setProfile({ name: "n", firm: "" });
  await c.setQuestionStatus({ post_id: "p", status: "answered" });
  await c.setSettings({ company_name: "Acme", cadence_days: 30 });
  await c.withdrawOffer({ ask_id: "a" });
}

describe("the contract's methods", () => {
  it("are exactly the committed ABI's, split into calls and views as it runs them", () => {
    const methods = Object.entries(abi.methods).filter(([, m]) => m.kind !== "init");
    expect([...CALLS].sort()).toEqual(methods.filter(([, m]) => m.kind === "call").map(([n]) => n).sort());
    expect([...VIEWS].sort()).toEqual(methods.filter(([, m]) => m.kind === "view").map(([n]) => n).sort());
  });

  it("are sent by name, as call or view, with exactly the ABI's parameter names", async () => {
    const { sent, transport } = recorder();
    await callEverything(new UpdatesClient(withRoutes(transport), "app-1"));
    const named = new Set(sent.map((s) => s.method));
    expect(named.size).toBe(CALLS.length + VIEWS.length);
    for (const { kind, method, args } of sent) {
      const m = abi.methods[method];
      expect(m, method).toBeDefined();
      expect(kind, method).toBe(m.kind);
      expect(Object.keys(args).sort(), method).toEqual(m.params.map(([p]) => p).sort());
    }
    expect(transport.call.mock.calls.every(([app]) => app === "app-1")).toBe(true);
  });

  it("sends nested input in camelCase and a u64 argument as a decimal string", async () => {
    const { sent, transport } = recorder();
    const c = new UpdatesClient(withRoutes(transport), "app-1");
    await c.publishUpdate({ input });
    await c.listContributions({ since: 1_700_000_000_000 });
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
    const c = new UpdatesClient(withRoutes(transport), "app-1", after);
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
