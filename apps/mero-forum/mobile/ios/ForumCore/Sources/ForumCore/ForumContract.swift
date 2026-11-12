import Foundation
import MeroKit

/// The forum contract on Calimero 1.0, as `logic/res/abi.json` declares it. The calls are
/// `ForumClient`, generated from the ABI into `Generated/`, and so are the answer types; this file
/// keeps the method lists of the web app's `src/lib/forumApi.ts`:
///
/// - method names and arguments are camelCase (`createPost`, `postId`, `commentId`);
/// - answers are camelCase, and `createdAt`, `editedAt`, `score` and
///   `commentCount` are decimal strings (`myVote` stays a number, an `i8`); the
///   generated types read either a string or a number;
/// - a refusal is `APP_ERROR` with `NotFound {what, id}`, `Forbidden {message}`
///   or `Invalid {message}` (MeroKit's ``AppError``), worded by ``ForumErrorText``.
public enum ForumContract {
    /// The ABI's calls. `ContractTests` checks these against the committed ABI.
    public static let calls = [
        "createPost", "editPost", "deletePost", "createComment", "editComment", "deleteComment", "vote", "voteComment",
        "setNickname", "setModerators", "moderatePost", "moderateComment",
    ]
    /// The ABI's views.
    public static let views = ["getPost", "listPosts", "listComments", "getNickname", "moderators"]
}

extension ForumClient {
    /// The forum client for one app instance, over the account's sealed session. `ForumClient` is
    /// generated from the ABI into `Generated/` (`scripts/mobile-codegen.sh` at the repo root).
    public static func make(contract: any ContextContract, contextId: String) -> ForumClient {
        ForumClient(contract: contract.bound(to: contextId))
    }
}

// MARK: - The answers

// The answer types are the generated client's (`Generated/ForumClient.swift`, from the ABI).

/// A post: `authorName` is `""` when the author never named themselves, `createdAt` unix
/// milliseconds, `myVote` the caller's own vote (-1, 0 or 1).
public typealias PostView = ForumClient.PostView
public typealias CommentView = ForumClient.CommentView
/// One page of posts: `nextCursor` is opaque, only good for the `sort` it came from.
public typealias PostPage = ForumClient.PostPage
public typealias CommentPage = ForumClient.CommentPage
