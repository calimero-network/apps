import { describe, expect, it, vi } from "vitest";

import { MeroForumClient } from "../generated/client";
import { toCommentView, toPost, toPostPage, toPostView } from "./forumApi";
import { withRoutes } from "@calimero-apps/connect/testing";

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

describe("the adapter, over the generated client", () => {
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
    const f = new MeroForumClient(withRoutes({ call, view }), "app-1", { after });

    expect(await f.createComment({ postId: "p1", body: "x" })).toBe("newid");
    expect(call).toHaveBeenCalledWith("app-1", "createComment", { postId: "p1", body: "x" });
    const page = toPostPage(await f.listPosts({ sort: "top", cursor: null, limit: 5 }));
    expect(view).toHaveBeenCalledWith("app-1", "listPosts", { sort: "top", cursor: null, limit: 5 });
    expect(page.next_cursor).toBe("cur");
    expect(page.items[0]?.score).toBe(-2);
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("runs `after` when a request fails too", async () => {
    const after = vi.fn();
    const f = new MeroForumClient(withRoutes({ call: vi.fn(), view: vi.fn().mockRejectedValue(new Error("boom")) }), "a", {
      after,
    });
    await expect(f.getPost({ postId: "x" }).then(toPost)).rejects.toThrow("boom");
    expect(after).toHaveBeenCalledTimes(1);
  });
});
