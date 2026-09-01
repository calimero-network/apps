// Stand-in for src/lib/forum.ts, aliased in by shots/vite.config.ts.
//
// Screenshots the REAL pages — same components, same CSS — with the node layer
// replaced by fixtures. Reading the code is not a substitute: a harness like
// this has caught layout bugs elsewhere in the fleet that review missed.
import { useCallback, useState } from "react";

import type { CommentView, PostView } from "../src/generated/ForumClient";

export type Sort = "new" | "top";

const AUTHORS = [
  "9f3c21aa77bd4e10c5f8a2b6d90e4471aa22bb33cc44dd55ee66ff7788990011",
  "1b7e44cc22aa9910ff8877665544332211aabbccddeeff00112233445566778a",
  "cc11dd22ee33ff4455667788990011223344556677889900aabbccddeeff0011",
];

const POSTS: PostView[] = [
  {
    id: "p1",
    author: AUTHORS[0],
    title: "Namespaces vs contexts — when should an app create a subgroup?",
    body: "Trying to work out the right granularity.",
    created_at: Date.now() - 42 * 60_000,
    edited_at: Date.now() - 42 * 60_000,
    score: 34,
    comment_count: 12,
    my_vote: 1,
  },
  {
    id: "p2",
    author: AUTHORS[1],
    title: "Measured: presence delivers ~96% of frames with one author",
    body: "Numbers from a four-node run.",
    created_at: Date.now() - 5 * 3_600_000,
    edited_at: Date.now() - 5 * 3_600_000,
    score: 21,
    comment_count: 4,
    my_vote: 0,
  },
  {
    id: "p3",
    author: AUTHORS[2],
    title: "rc.28 upgrade notes — the entry API is the blessed path now",
    body: "Cloning a Counter out of a map is rejected, and rightly so.",
    created_at: Date.now() - 26 * 3_600_000,
    edited_at: Date.now() - 26 * 3_600_000,
    score: -2,
    comment_count: 0,
    my_vote: -1,
  },
];

const COMMENTS: CommentView[] = [
  {
    id: "c1",
    post_id: "p1",
    author: AUTHORS[1],
    body: "A namespace per team, a subgroup per topic. The subgroup is the unit of membership.",
    created_at: Date.now() - 30 * 60_000,
    edited_at: Date.now() - 30 * 60_000,
  },
  {
    id: "c2",
    post_id: "p1",
    author: AUTHORS[2],
    body: "Worth adding: a restricted subgroup is the default, so an open one has to be asked for explicitly.",
    created_at: Date.now() - 12 * 60_000,
    edited_at: Date.now() - 12 * 60_000,
  },
];

export function useForumContext() {
  return { contextId: "ctx", loading: false };
}
export function useForumClient() {
  return {
    listPosts: async () => ({ items: POSTS, next_cursor: null }),
    getPost: async () => POSTS[0],
    listComments: async () => ({ items: COMMENTS, next_cursor: null }),
    createPost: async () => "p0",
    createComment: async () => "c0",
    vote: async () => undefined,
  } as never;
}
export function useFeed() {
  const [items, setItems] = useState<PostView[]>(POSTS);
  return {
    items,
    loadMore: useCallback(() => undefined, []),
    hasMore: false,
    loading: false,
    error: null,
    reset: useCallback(() => undefined, []),
    setItems,
  };
}
export function useComments() {
  return {
    items: COMMENTS,
    loadMore: () => undefined,
    hasMore: false,
    loading: false,
    reload: () => undefined,
  };
}
export { shortAuthor, timeAgo } from "../src/lib/forum";
