import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CALLS, ForumClient, VIEWS, toCommentView, toPostView } from "./forumApi";
import { withRoutes } from "@calimero-apps/connect/testing";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

const WIRE_POST = {
  id: "p1",
  author: "acct",
  authorName: "Ana",
  title: "t",
  body: "b",
  createdAt: "1700000000000",
  editedAt: "1700000000500",
  score: "-2",
  commentCount: "3",
  myVote: -1,
};

const WIRE_COMMENT = {
  id: "c1",
  postId: "p1",
  author: "acct",
  authorName: "",
  body: "hi",
  createdAt: "1700000000001",
  editedAt: "1700000000001",
  score: "4",
  myVote: 1,
};

describe("the client covers the contract", () => {
  it("calls exactly the contract's calls, and views exactly its views", () => {
    expect([...CALLS].sort()).toEqual(byKind("call"));
    expect([...VIEWS].sort()).toEqual(byKind("view"));
    expect(byKind("init")).toEqual(["init"]);
  });

  it("sends each method the parameter names the ABI declares", async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      const result = method === "listPosts" || method === "listComments" ? { items: [], nextCursor: null } : method === "getPost" ? WIRE_POST : null;
      return Promise.resolve({ index: 1, result, events: [] });
    };
    const f = new ForumClient(withRoutes({ call: vi.fn(record), view: vi.fn(record) }), "app-1");
    await Promise.all([
      f.createPost({ title: "t", body: "b" }),
      f.editPost({ post_id: "p", title: "t", body: "b" }),
      f.deletePost({ post_id: "p" }),
      f.getPost({ post_id: "p" }),
      f.listPosts({ sort: null, cursor: null, limit: 20 }),
      f.createComment({ post_id: "p", body: "b" }),
      f.editComment({ comment_id: "c", body: "b" }),
      f.deleteComment({ comment_id: "c" }),
      f.listComments({ post_id: "p", cursor: null, limit: 20 }),
      f.vote({ post_id: "p", value: 1 }),
      f.voteComment({ comment_id: "c", value: 1 }),
      f.setNickname({ name: "n" }),
      f.getNickname({ account: "a" }),
      f.moderators(),
      f.setModerators({ accounts: ["a"] }),
      f.moderatePost({ post_id: "p" }),
      f.moderateComment({ comment_id: "c" }),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === "init") continue;
      expect(sent.get(name), name).toEqual(method.params.map(([p]) => p).sort());
    }
  });
});

describe("the adapter", () => {
  it("turns the contract's answers into the shapes the screens use", () => {
    expect(toPostView(WIRE_POST)).toEqual({
      id: "p1",
      author: "acct",
      author_name: "Ana",
      title: "t",
      body: "b",
      created_at: 1700000000000,
      edited_at: 1700000000500,
      score: -2,
      comment_count: 3,
      my_vote: -1,
    });
    expect(toCommentView(WIRE_COMMENT)).toEqual({
      id: "c1",
      post_id: "p1",
      author: "acct",
      author_name: "",
      body: "hi",
      created_at: 1700000000001,
      edited_at: 1700000000001,
      score: 4,
      my_vote: 1,
    });
  });

  it("routes calls through the log and views to a node, with camelCase arguments", async () => {
    const call = vi.fn().mockResolvedValue({ index: 3, result: "newid", events: [] });
    const view = vi
      .fn()
      .mockResolvedValue({ index: 3, result: { items: [WIRE_POST], nextCursor: "cur" } });
    const after = vi.fn();
    const f = new ForumClient(withRoutes({ call, view }), "app-1", after);

    expect(await f.createComment({ post_id: "p1", body: "x" })).toBe("newid");
    expect(call).toHaveBeenCalledWith("app-1", "createComment", { postId: "p1", body: "x" });
    const page = await f.listPosts({ sort: "top", cursor: null, limit: 5 });
    expect(view).toHaveBeenCalledWith("app-1", "listPosts", { sort: "top", cursor: null, limit: 5 });
    expect(page.next_cursor).toBe("cur");
    expect(page.items[0]?.score).toBe(-2);
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("runs `after` when a request fails too", async () => {
    const after = vi.fn();
    const f = new ForumClient(withRoutes({ call: vi.fn(), view: vi.fn().mockRejectedValue(new Error("boom")) }), "a", after);
    await expect(f.getPost({ post_id: "x" })).rejects.toThrow("boom");
    expect(after).toHaveBeenCalledTimes(1);
  });
});
