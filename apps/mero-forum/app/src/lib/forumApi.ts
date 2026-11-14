/**
 * The ONE place the forum contract's answers are adapted to the shapes the
 * screens use. The contract is called through `MeroForumClient`, which
 * `meroctl app codegen` writes from logic/res/abi.json
 * (`src/generated/client.ts`) and types its records from the ABI; each read
 * passes its answer through the adapter for its shape below.
 *
 * The component contract answers camelCase records with 64-bit integers as
 * decimal strings (`"createdAt": "1700000000000"`, `"score": "-1"`). The
 * screens were written against v1's generated client: snake_case fields and
 * plain numbers. Converting here keeps every screen as it was.
 */

import type {
  CommentPage as WireCommentPage,
  CommentView as WireComment,
  PostPage as WirePostPage,
  PostView as WirePost,
} from "../generated/client";

// ── what the screens use (v1's shapes) ───────────────────────────────────────

export interface PostView {
  id: string;
  author: string;
  /** "" when the author never named themselves. */
  author_name: string;
  title: string;
  body: string;
  /** Unix milliseconds. */
  created_at: number;
  edited_at: number;
  score: number;
  comment_count: number;
  /** The caller's own vote: -1, 0 or 1. */
  my_vote: number;
}

export interface CommentView {
  id: string;
  post_id: string;
  author: string;
  author_name: string;
  body: string;
  created_at: number;
  edited_at: number;
  score: number;
  my_vote: number;
}

export interface PostPage {
  items: PostView[];
  next_cursor: string | null;
}

export interface CommentPage {
  items: CommentView[];
  next_cursor: string | null;
}

// ── what the contract answers (the generated client's types) ─────────────────

export type { WireComment, WirePost };

/** A u64 / i64 travels as a decimal string. */
type Int = string;

/** A decimal string as a number. Timestamps and scores are well inside 2^53. */
export function int(value: Int | number): number {
  return typeof value === "number" ? value : Number(value);
}

export function toPostView(p: WirePost): PostView {
  return {
    id: p.id,
    author: p.author,
    author_name: p.authorName,
    title: p.title,
    body: p.body,
    created_at: int(p.createdAt),
    edited_at: int(p.editedAt),
    score: int(p.score),
    comment_count: int(p.commentCount),
    my_vote: p.myVote,
  };
}

export function toCommentView(c: WireComment): CommentView {
  return {
    id: c.id,
    post_id: c.postId,
    author: c.author,
    author_name: c.authorName,
    body: c.body,
    created_at: int(c.createdAt),
    edited_at: int(c.editedAt),
    score: int(c.score),
    my_vote: c.myVote,
  };
}

/** `getPost`'s answer. */
export const toPost = (v: WirePost): PostView => toPostView(v);

/** `listPosts`'s answer. */
export function toPostPage(page: WirePostPage): PostPage {
  return { items: page.items.map(toPostView), next_cursor: page.nextCursor };
}

/** `listComments`'s answer. */
export function toCommentPage(page: WireCommentPage): CommentPage {
  return { items: page.items.map(toCommentView), next_cursor: page.nextCursor };
}
