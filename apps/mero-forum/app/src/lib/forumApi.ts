import { type ClientRoutes } from "@calimero-apps/connect";

/**
 * The forum contract, typed (no client is generated from a component ABI yet),
 * and the ONE place its answers are adapted to the shapes the screens use.
 *
 * The component contract answers camelCase records with 64-bit integers as
 * decimal strings (`"createdAt": "1700000000000"`, `"score": "-1"`). The
 * screens were written against v1's generated client: snake_case fields and
 * plain numbers. Converting here keeps every screen as it was.
 *
 * The method lists are split the way the node runs them: a call goes through
 * the app's log, a view is answered by a node without writing.
 * `forumApi.test.ts` asserts they are exactly the committed
 * `logic/res/abi.json`'s, with the same parameter names.
 */
export const CALLS = [
  "createPost",
  "editPost",
  "deletePost",
  "createComment",
  "editComment",
  "deleteComment",
  "vote",
  "voteComment",
  "setNickname",
  "setModerators",
  "moderatePost",
  "moderateComment",
] as const;
export const VIEWS = ["getPost", "listPosts", "listComments", "getNickname", "moderators"] as const;

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

// ── what the contract answers ────────────────────────────────────────────────

/** A u64 / i64 travels as a decimal string. */
type Int = string;

export interface WirePost {
  id: string;
  author: string;
  authorName: string;
  title: string;
  body: string;
  createdAt: Int;
  editedAt: Int;
  score: Int;
  commentCount: Int;
  myVote: number;
}

export interface WireComment {
  id: string;
  postId: string;
  author: string;
  authorName: string;
  body: string;
  createdAt: Int;
  editedAt: Int;
  score: Int;
  myVote: number;
}

interface WirePage<T> {
  items: T[];
  nextCursor: string | null;
}

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

type Transport = ClientRoutes<{ apps: "call" | "view" }>;

/**
 * The forum at app instance `app`, with v1's generated client's method names
 * and argument shapes. `after` runs after every request (the session store
 * syncs a refreshed session there).
 */
export class ForumClient {
  constructor(
    private readonly client: Transport,
    readonly app: string,
    private readonly after: () => void = () => {},
  ) {}

  private async call<T>(method: (typeof CALLS)[number], args: Record<string, unknown>): Promise<T> {
    try {
      return (await this.client.apps.call({ app: this.app, method, args })).result as T;
    } finally {
      this.after();
    }
  }

  private async view<T>(method: (typeof VIEWS)[number], args: Record<string, unknown> = {}): Promise<T> {
    try {
      return (await this.client.apps.view({ app: this.app, method, args })).result as T;
    } finally {
      this.after();
    }
  }

  createPost(p: { title: string; body: string }): Promise<string> {
    return this.call("createPost", { title: p.title, body: p.body });
  }

  async editPost(p: { post_id: string; title: string; body: string }): Promise<void> {
    await this.call("editPost", { postId: p.post_id, title: p.title, body: p.body });
  }

  async deletePost(p: { post_id: string }): Promise<void> {
    await this.call("deletePost", { postId: p.post_id });
  }

  async getPost(p: { post_id: string }): Promise<PostView> {
    return toPostView(await this.view<WirePost>("getPost", { postId: p.post_id }));
  }

  /** `cursor` is opaque, and only good for the `sort` it came from. */
  async listPosts(p: { sort: string | null; cursor: string | null; limit: number }): Promise<PostPage> {
    const page = await this.view<WirePage<WirePost>>("listPosts", {
      sort: p.sort,
      cursor: p.cursor,
      limit: p.limit,
    });
    return { items: page.items.map(toPostView), next_cursor: page.nextCursor };
  }

  createComment(p: { post_id: string; body: string }): Promise<string> {
    return this.call("createComment", { postId: p.post_id, body: p.body });
  }

  async editComment(p: { comment_id: string; body: string }): Promise<void> {
    await this.call("editComment", { commentId: p.comment_id, body: p.body });
  }

  async deleteComment(p: { comment_id: string }): Promise<void> {
    await this.call("deleteComment", { commentId: p.comment_id });
  }

  async listComments(p: { post_id: string; cursor: string | null; limit: number }): Promise<CommentPage> {
    const page = await this.view<WirePage<WireComment>>("listComments", {
      postId: p.post_id,
      cursor: p.cursor,
      limit: p.limit,
    });
    return { items: page.items.map(toCommentView), next_cursor: page.nextCursor };
  }

  async vote(p: { post_id: string; value: number }): Promise<void> {
    await this.call("vote", { postId: p.post_id, value: p.value });
  }

  async voteComment(p: { comment_id: string; value: number }): Promise<void> {
    await this.call("voteComment", { commentId: p.comment_id, value: p.value });
  }

  async setNickname(p: { name: string }): Promise<void> {
    await this.call("setNickname", { name: p.name });
  }

  getNickname(p: { account: string }): Promise<string> {
    return this.view("getNickname", { account: p.account });
  }

  moderators(): Promise<string[]> {
    return this.view("moderators");
  }

  async setModerators(p: { accounts: string[] }): Promise<void> {
    await this.call("setModerators", { accounts: p.accounts });
  }

  async moderatePost(p: { post_id: string }): Promise<void> {
    await this.call("moderatePost", { postId: p.post_id });
  }

  async moderateComment(p: { comment_id: string }): Promise<void> {
    await this.call("moderateComment", { commentId: p.comment_id });
  }
}
