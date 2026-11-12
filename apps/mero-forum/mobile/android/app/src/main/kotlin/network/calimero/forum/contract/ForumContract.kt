package network.calimero.forum.contract

import network.calimero.forum.generated.ForumClient

/**
 * The forum contract on Calimero 1.0, as `logic/res/abi.json` declares it. The calls are the
 * generated [ForumClient] (`scripts/mobile-codegen.sh` at the repo root), and so are the answer
 * types; this file keeps the method lists of the web app's `src/lib/forumApi.ts` (Swift
 * `ForumContract`):
 *
 * - method names and arguments are camelCase (`createPost`, `postId`, `commentId`);
 * - answers are camelCase, and `createdAt`, `editedAt`, `score` and `commentCount` are decimal
 *   strings (`myVote` stays a number, an `i8`); the generated types read either a string or a number;
 * - a refusal is `APP_ERROR` with `NotFound {what, id}`, `Forbidden {message}` or
 *   `Invalid {message}`, worded by `ForumErrorText`.
 */
object ForumContract {
    /** The ABI's calls. `ContractTest` checks them against the committed ABI. */
    val CALLS =
        listOf(
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
        )

    /** The ABI's views. */
    val VIEWS = listOf("getPost", "listPosts", "listComments", "getNickname", "moderators")
}

// The answer types are the generated client's ([ForumClient], from the ABI).

/**
 * A post: `authorName` is `""` when the author never named themselves, `createdAt` unix
 * milliseconds, `myVote` the caller's own vote (-1, 0 or 1).
 */
typealias PostView = ForumClient.PostView

typealias CommentView = ForumClient.CommentView

/** One page of posts: `nextCursor` is opaque, only good for the `sort` it came from. */
typealias PostPage = ForumClient.PostPage

typealias CommentPage = ForumClient.CommentPage
