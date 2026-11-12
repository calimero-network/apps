import Foundation
import MeroKit

/// The forum contract on Calimero 1.0, as `logic/res/abi.json` declares it. The calls are
/// `ForumClient`, generated from the ABI into `Generated/`; this file keeps the method lists and
/// the answer types of the web app's `src/lib/forumApi.ts`:
///
/// - method names and arguments are camelCase (`createPost`, `postId`, `commentId`);
/// - answers are camelCase, and `createdAt`, `editedAt`, `score` and
///   `commentCount` are decimal strings (`myVote` stays a number); the types
///   below read either a string or a number;
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

extension Encodable {
    /// This answer as the app type `T` (one of the types below), read through its JSON: the
    /// generated client answers its own typed records (`PostView`, `PostPage`, `CommentPage`).
    func decoded<T: Decodable>(as type: T.Type) throws -> T {
        try MeroJSON.decode(type, from: MeroJSON.encode(self))
    }
}

// MARK: - The answers

/// A 64-bit integer off the wire: a decimal string (the component ABI), or a plain number.
struct WireInt<T: FixedWidthInteger & Codable & Sendable>: Codable, Sendable {
    let value: T

    init(_ value: T) { self.value = value }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let text = try? c.decode(String.self) {
            guard let parsed = T(text) else {
                throw DecodingError.dataCorruptedError(in: c, debugDescription: "not an integer: \(text)")
            }
            value = parsed
        } else {
            value = try c.decode(T.self)
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(String(value))
    }
}

public struct PostView: Codable, Sendable, Equatable {
    public var id: String
    public var author: String
    /// `""` when the author never named themselves.
    public var authorName: String
    public var title: String
    public var body: String
    /// Unix milliseconds.
    public var createdAt: UInt64
    public var editedAt: UInt64
    public var score: Int64
    public var commentCount: UInt64
    /// The caller's own vote: -1, 0 or 1.
    public var myVote: Int32

    public init(
        id: String, author: String, authorName: String, title: String, body: String, createdAt: UInt64,
        editedAt: UInt64, score: Int64, commentCount: UInt64, myVote: Int32
    ) {
        self.id = id
        self.author = author
        self.authorName = authorName
        self.title = title
        self.body = body
        self.createdAt = createdAt
        self.editedAt = editedAt
        self.score = score
        self.commentCount = commentCount
        self.myVote = myVote
    }

    enum CodingKeys: String, CodingKey {
        case id, author, authorName, title, body, createdAt, editedAt, score, commentCount, myVote
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        author = try c.decode(String.self, forKey: .author)
        authorName = try c.decodeIfPresent(String.self, forKey: .authorName) ?? ""
        title = try c.decode(String.self, forKey: .title)
        body = try c.decode(String.self, forKey: .body)
        createdAt = try c.decode(WireInt<UInt64>.self, forKey: .createdAt).value
        editedAt = try c.decode(WireInt<UInt64>.self, forKey: .editedAt).value
        score = try c.decode(WireInt<Int64>.self, forKey: .score).value
        commentCount = try c.decode(WireInt<UInt64>.self, forKey: .commentCount).value
        myVote = try c.decode(Int32.self, forKey: .myVote)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(author, forKey: .author)
        try c.encode(authorName, forKey: .authorName)
        try c.encode(title, forKey: .title)
        try c.encode(body, forKey: .body)
        try c.encode(WireInt(createdAt), forKey: .createdAt)
        try c.encode(WireInt(editedAt), forKey: .editedAt)
        try c.encode(WireInt(score), forKey: .score)
        try c.encode(WireInt(commentCount), forKey: .commentCount)
        try c.encode(myVote, forKey: .myVote)
    }
}

public struct CommentView: Codable, Sendable, Equatable {
    public var id: String
    public var postId: String
    public var author: String
    public var authorName: String
    public var body: String
    public var createdAt: UInt64
    public var editedAt: UInt64
    public var score: Int64
    public var myVote: Int32

    public init(
        id: String, postId: String, author: String, authorName: String, body: String, createdAt: UInt64,
        editedAt: UInt64, score: Int64, myVote: Int32
    ) {
        self.id = id
        self.postId = postId
        self.author = author
        self.authorName = authorName
        self.body = body
        self.createdAt = createdAt
        self.editedAt = editedAt
        self.score = score
        self.myVote = myVote
    }

    enum CodingKeys: String, CodingKey {
        case id, postId, author, authorName, body, createdAt, editedAt, score, myVote
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        postId = try c.decode(String.self, forKey: .postId)
        author = try c.decode(String.self, forKey: .author)
        authorName = try c.decodeIfPresent(String.self, forKey: .authorName) ?? ""
        body = try c.decode(String.self, forKey: .body)
        createdAt = try c.decode(WireInt<UInt64>.self, forKey: .createdAt).value
        editedAt = try c.decode(WireInt<UInt64>.self, forKey: .editedAt).value
        score = try c.decode(WireInt<Int64>.self, forKey: .score).value
        myVote = try c.decode(Int32.self, forKey: .myVote)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(postId, forKey: .postId)
        try c.encode(author, forKey: .author)
        try c.encode(authorName, forKey: .authorName)
        try c.encode(body, forKey: .body)
        try c.encode(WireInt(createdAt), forKey: .createdAt)
        try c.encode(WireInt(editedAt), forKey: .editedAt)
        try c.encode(WireInt(score), forKey: .score)
        try c.encode(myVote, forKey: .myVote)
    }
}

public struct PostPage: Codable, Sendable, Equatable {
    public var items: [PostView]
    /// Opaque; only good for the `sort` it came from.
    public var nextCursor: String?

    public init(items: [PostView], nextCursor: String? = nil) {
        self.items = items
        self.nextCursor = nextCursor
    }
}

public struct CommentPage: Codable, Sendable, Equatable {
    public var items: [CommentView]
    public var nextCursor: String?

    public init(items: [CommentView], nextCursor: String? = nil) {
        self.items = items
        self.nextCursor = nextCursor
    }
}
