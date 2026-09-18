// Aliased over ../../src/lib/forum by vite.config.ts, so the feed and thread
// pages render their real markup against fixture rows. See ../shots.mjs.
import { COMMENTS, POSTS, SELF, scenarioById } from "./fixtures";

const sc = () =>
  scenarioById(new URLSearchParams(location.search).get("s") ?? "feed");

export type Sort = "new" | "top";

// Explicit `.ts` — see nickname.mock.ts for why.
export { timeAgo } from "../../src/lib/forum.ts";

/** A client object that is non-null (so the pages render) and never dials out. */
const CLIENT = {
  createPost: async () => "p9",
  createComment: async () => "c9",
  deletePost: async () => {},
  deleteComment: async () => {},
  editComment: async () => {},
  vote: async () => {},
  voteComment: async () => {},
  setNickname: async () => {},
  getNickname: async () => "Ana",
  getPost: async () => POSTS[0],
};

export function useForumClient() {
  return CLIENT as never;
}

export function useForumContext() {
  return { contextId: "ctx-1", loading: false };
}

export function useSelfAccount() {
  return SELF;
}

export function useFeed() {
  return {
    items: sc().empty ? [] : POSTS,
    loadMore: () => {},
    hasMore: false,
    loading: false,
    error: null,
    reset: () => {},
    setItems: () => {},
  };
}

export function useComments() {
  return {
    items: COMMENTS,
    loadMore: () => {},
    hasMore: false,
    loading: false,
    reload: () => {},
    setItems: () => {},
  };
}
