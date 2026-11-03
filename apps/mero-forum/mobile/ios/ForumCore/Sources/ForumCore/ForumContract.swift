import Foundation
import MeroKit

/// The forum contract on Calimero 1.0, typed by hand from `logic/res/abi.json`
/// (no client is generated from a component ABI yet). The port of the web
/// app's `src/lib/forumApi.ts`, method for method:
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

/// Typed calls to one forum's contract. Views go through `query`, everything else through `execute`.
public struct ForumClient: Sendable {
    public let transport: any ContextContractCalling

    public init(transport: any ContextContractCalling) {
        self.transport = transport
    }

    /// The forum client for one app instance, over the account's sealed session.
    public static func make(contract: any ContextContract, contextId: String) -> ForumClient {
        ForumClient(transport: contract.bound(to: contextId))
    }

    // MARK: Posts

    @discardableResult
    public func createPost(title: String, body: String) async throws -> String {
        try await call("createPost", ["title": .string(title), "body": .string(body)], as: String.self)
    }

    public func editPost(postId: String, title: String, body: String) async throws {
        try await run("editPost", ["postId": .string(postId), "title": .string(title), "body": .string(body)])
    }

    public func deletePost(postId: String) async throws { try await run("deletePost", ["postId": .string(postId)]) }

    public func getPost(postId: String) async throws -> PostView {
        try await view("getPost", ["postId": .string(postId)])
    }

    /// One page of the feed. `cursor` is opaque, and only good for the `sort` it came from.
    public func listPosts(sort: String? = nil, cursor: String? = nil, limit: UInt32) async throws -> PostPage {
        try await view(
            "listPosts",
            ["sort": sort.map(JSONValue.string) ?? .null, "cursor": cursor.map(JSONValue.string) ?? .null,
             "limit": .number(Double(limit))])
    }

    // MARK: Comments

    @discardableResult
    public func createComment(postId: String, body: String) async throws -> String {
        try await call("createComment", ["postId": .string(postId), "body": .string(body)], as: String.self)
    }

    public func editComment(commentId: String, body: String) async throws {
        try await run("editComment", ["commentId": .string(commentId), "body": .string(body)])
    }

    public func deleteComment(commentId: String) async throws {
        try await run("deleteComment", ["commentId": .string(commentId)])
    }

    public func listComments(postId: String, cursor: String? = nil, limit: UInt32) async throws -> CommentPage {
        try await view(
            "listComments",
            ["postId": .string(postId), "cursor": cursor.map(JSONValue.string) ?? .null, "limit": .number(Double(limit))])
    }

    // MARK: Votes, names, moderation

    /// `value` is -1, 0 (remove) or 1.
    public func vote(postId: String, value: Int32) async throws {
        try await run("vote", ["postId": .string(postId), "value": .number(Double(value))])
    }

    public func voteComment(commentId: String, value: Int32) async throws {
        try await run("voteComment", ["commentId": .string(commentId), "value": .number(Double(value))])
    }

    public func setNickname(name: String) async throws { try await run("setNickname", ["name": .string(name)]) }

    public func getNickname(account: String) async throws -> String {
        try await view("getNickname", ["account": .string(account)])
    }

    public func moderators() async throws -> [String] { try await view("moderators", [:]) }

    public func setModerators(accounts: [String]) async throws {
        try await run("setModerators", ["accounts": .array(accounts.map(JSONValue.string))])
    }

    public func moderatePost(postId: String) async throws {
        try await run("moderatePost", ["postId": .string(postId)])
    }

    public func moderateComment(commentId: String) async throws {
        try await run("moderateComment", ["commentId": .string(commentId)])
    }

    // MARK: Wire

    private func view<T: Decodable>(_ method: String, _ args: [String: JSONValue]) async throws -> T {
        let data = try await transport.query(method: method, argsJSON: try JSONEncoder().encode(JSONValue.object(args)))
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func call<T: Decodable>(_ method: String, _ args: [String: JSONValue], as: T.Type) async throws -> T {
        let data = try await transport.execute(method: method, argsJSON: try JSONEncoder().encode(JSONValue.object(args)))
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func run(_ method: String, _ args: [String: JSONValue]) async throws {
        _ = try await transport.execute(method: method, argsJSON: try JSONEncoder().encode(JSONValue.object(args)))
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
