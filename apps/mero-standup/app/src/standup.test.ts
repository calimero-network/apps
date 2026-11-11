import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CALLS, VIEWS, standup, type StandupClient } from "./standup";
import { withRoutes } from "@calimero-apps/connect/testing";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

/** One request of every method, with arguments of the right shape. */
function everyMethod(c: StandupClient): Array<Promise<unknown>> {
  return [
    c.whoami(),
    c.postUpdate({ day: "2026-10-13", done: "d", next: "n", blockers: "" }),
    c.clearUpdate({ day: "2026-10-13" }),
    c.getDay({ day: "2026-10-13" }),
    c.listDays({ before: null, limit: 10 }),
    c.currentBlockers(),
    c.members(),
    c.logDecision({ title: "t", decision: "d", rationale: "", supersedes: null, tags: [], with: [], from_day: null }),
    c.getDecision({ id: "x" }),
    c.listDecisions({ search: null, tag: null, from_day: null, standing_only: false, cursor: null, limit: 0 }),
    c.tags(),
    c.offerHelp({ day: "2026-10-13", author: "a", note: "" }),
    c.withdrawHelp({ day: "2026-10-13", author: "a" }),
    c.getWeek({ start: "2026-10-12" }),
    c.setTeamName({ name: "n" }),
    c.teamName(),
    c.setName({ name: "n" }),
    c.getName({ account: "a" }),
  ];
}

describe("the client covers the contract", () => {
  it("calls exactly the contract's calls, and views exactly its views", () => {
    expect([...CALLS].sort()).toEqual(byKind("call"));
    expect([...VIEWS].sort()).toEqual(byKind("view"));
    expect(byKind("init")).toEqual(["init"]);
  });

  it("sends each method the parameter names the ABI declares, the right way", async () => {
    const sent = new Map<string, { kind: string; params: string[] }>();
    const record = (kind: string) => (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, { kind, params: Object.keys(args as object).sort() });
      return Promise.resolve({ index: 1, result: null, events: [] });
    };
    await Promise.all(everyMethod(standup(withRoutes({ call: vi.fn(record("call")), view: vi.fn(record("view")) }), "app-1")));
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === "init") continue;
      expect(sent.get(name), name).toEqual({ kind: method.kind, params: method.params.map(([p]) => p).sort() });
    }
  });
});

describe("standup", () => {
  it("turns the contract's camelCase and decimal strings into the screens' shapes", async () => {
    const update = {
      day: "2026-10-13",
      author: "acct-bob",
      authorName: "Bob",
      done: "d",
      next: "n",
      blockers: "b",
      createdAt: "1700000000000",
      editedAt: "1700000001000",
      helpers: [{ account: "acct-ana", name: "Ana", note: "", at: "1700000002000" }],
    };
    const view = vi.fn(async (_app: string, method: string) => {
      const result =
        method === "getDay"
          ? { day: "2026-10-13", updates: [update] }
          : method === "listDecisions"
            ? {
                items: [
                  {
                    id: "d1",
                    author: "acct-ana",
                    authorName: "",
                    title: "t",
                    decision: "d",
                    rationale: "",
                    supersedes: "",
                    supersededBy: "d2",
                    createdAt: "5",
                    tags: ["infra"],
                    with: [{ account: "acct-bob", name: "Bob" }],
                    fromDay: "2026-10-13",
                  },
                ],
                nextCursor: "d1",
              }
            : { days: [{ day: "2026-10-13", updates: 2, blocked: 1 }], nextCursor: null };
      return { index: 1, result };
    });
    const c = standup(withRoutes({ call: vi.fn(), view }), "app-1");

    const day = await c.getDay({ day: "2026-10-13" });
    expect(day.updates[0]).toEqual({
      day: "2026-10-13",
      author: "acct-bob",
      author_name: "Bob",
      done: "d",
      next: "n",
      blockers: "b",
      created_at: 1700000000000,
      edited_at: 1700000001000,
      helpers: [{ account: "acct-ana", name: "Ana", note: "", at: 1700000002000 }],
    });

    const page = await c.listDecisions({
      search: null,
      tag: "infra",
      from_day: "2026-10-13",
      standing_only: true,
      cursor: null,
      limit: 5,
    });
    expect(view).toHaveBeenLastCalledWith("app-1", "listDecisions", {
      search: null,
      tag: "infra",
      fromDay: "2026-10-13",
      standingOnly: true,
      cursor: null,
      limit: 5,
    });
    expect(page.next_cursor).toBe("d1");
    expect(page.items[0]).toMatchObject({ superseded_by: "d2", created_at: 5, from_day: "2026-10-13", author_name: "" });

    expect(await c.listDays({ before: null, limit: 3 })).toEqual({
      days: [{ day: "2026-10-13", updates: 2, blocked: 1 }],
      next_cursor: null,
    });
  });

  it("routes writes through the log, sends camelCase arguments, and runs `after` even on failure", async () => {
    const call = vi.fn().mockResolvedValue({ index: 3, result: "abc", events: [] });
    const after = vi.fn();
    const c = standup(withRoutes({ call, view: vi.fn().mockRejectedValue(new Error("boom")) }), "app-1", after);
    expect(
      await c.logDecision({
        title: "t",
        decision: "d",
        rationale: "",
        supersedes: null,
        tags: ["x"],
        with: [],
        from_day: "2026-10-13",
      }),
    ).toBe("abc");
    expect(call).toHaveBeenCalledWith("app-1", "logDecision", {
      title: "t",
      decision: "d",
      rationale: "",
      supersedes: null,
      tags: ["x"],
      with: [],
      fromDay: "2026-10-13",
    });
    await expect(c.teamName()).rejects.toThrow("boom");
    expect(after).toHaveBeenCalledTimes(2);
  });
});
