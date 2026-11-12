import { describe, expect, it, vi } from "vitest";

import { MeroStandupClient } from "./generated/client";
import { decodeDayAnswer, decodeDayPage, decodeDecisionPage, decodeText } from "./standup";
import { withRoutes } from "@calimero-apps/connect/testing";

describe("the screens' shapes, over the generated client", () => {
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
    const c = new MeroStandupClient(withRoutes({ call: vi.fn(), view }), "app-1");

    const day = decodeDayAnswer(await c.getDay({ day: "2026-10-13" }));
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

    const page = decodeDecisionPage(
      await c.listDecisions({
        search: null,
        tag: "infra",
        fromDay: "2026-10-13",
        standingOnly: true,
        cursor: null,
        limit: 5,
      }),
    );
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

    expect(decodeDayPage(await c.listDays({ before: null, limit: 3 }))).toEqual({
      days: [{ day: "2026-10-13", updates: 2, blocked: 1 }],
      next_cursor: null,
    });
  });

  it("routes writes through the log, sends camelCase arguments, and runs `after` even on failure", async () => {
    const call = vi.fn().mockResolvedValue({ index: 3, result: "abc", events: [] });
    const after = vi.fn();
    const c = new MeroStandupClient(withRoutes({ call, view: vi.fn().mockRejectedValue(new Error("boom")) }), "app-1", {
      after,
    });
    expect(
      decodeText(
        await c.logDecision({
          title: "t",
          decision: "d",
          rationale: "",
          supersedes: null,
          tags: ["x"],
          with: [],
          fromDay: "2026-10-13",
        }),
      ),
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
