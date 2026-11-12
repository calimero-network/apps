import Foundation
import MeroKit

// The tracker contract's component ABI (`logic/res/abi.json`). The calls are `IssueTrackerClient`,
// generated from it into `Generated/` by core's `mero-app-build codegen` (`scripts/mobile-codegen.sh`
// at the repo root); this file keeps the method lists `ContractWireTests` pins and the answer types,
// in step with the web client (`app/src/tracker.ts`) and the Kotlin `contract/IssueTrackerContract.kt`.
//
// On the wire:
// - method, argument and field names are camelCase (`createIssue`, `issueId`);
// - 64-bit integers (`createdAt`, `editedAt`, a status `count`) are decimal
//   strings; they are decoded from a string or a number and sent as strings;
// - a refusal is `422 APP_ERROR { code, fields }` (MeroKit's `AppError`), with
//   the codes `NotFound { id }`, `Invalid { message }` and `Forbidden { message }`.

extension IssueTrackerClient {
    /// The contract's calls (writes), by their ABI names.
    public static let calls = [
        "setRepoUrl", "createIssue", "setStatus", "setSummary", "setImpact", "setRepro", "setResolutionCriteria",
        "setPriority", "setAssignee", "addLabel", "removeLabel", "addComment", "editComment", "deleteComment",
        "deleteIssue",
    ]
    /// The contract's views (reads), by their ABI names.
    public static let views = ["getRepoInfo", "listIssues", "getIssue", "getStatusCounts"]
}

extension Encodable {
    /// This answer as the app type `T` (one of the types below), read through its JSON: the
    /// generated client answers its own typed records.
    func decoded<T: Decodable>(as type: T.Type) throws -> T {
        try MeroJSON.decode(type, from: MeroJSON.encode(self))
    }
}

// MARK: - Answers

/// One issue as `listIssues` and `getIssue` answer it.
public struct IssueView: Codable, Sendable, Equatable {
    public var id: String
    public var title: String
    public var summary: String
    public var impact: String
    public var repro: String
    public var resolutionCriteria: String
    /// One of Open, In progress, Blocked, Done.
    public var status: String
    /// `low`, `medium`, `high` or `urgent`.
    public var priority: String
    public var assignee: String?
    public var labels: [String]
    /// The filer's account id: only they may delete it.
    public var createdBy: String
    /// Unix milliseconds.
    public var createdAt: UInt64

    public init(
        id: String, title: String, summary: String, impact: String, repro: String, resolutionCriteria: String,
        status: String, priority: String, assignee: String? = nil, labels: [String], createdBy: String,
        createdAt: UInt64
    ) {
        self.id = id
        self.title = title
        self.summary = summary
        self.impact = impact
        self.repro = repro
        self.resolutionCriteria = resolutionCriteria
        self.status = status
        self.priority = priority
        self.assignee = assignee
        self.labels = labels
        self.createdBy = createdBy
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id, title, summary, impact, repro, resolutionCriteria, status, priority, assignee, labels, createdBy,
            createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        summary = try c.decode(String.self, forKey: .summary)
        impact = try c.decode(String.self, forKey: .impact)
        repro = try c.decode(String.self, forKey: .repro)
        resolutionCriteria = try c.decode(String.self, forKey: .resolutionCriteria)
        status = try c.decode(String.self, forKey: .status)
        priority = try c.decode(String.self, forKey: .priority)
        assignee = try c.decodeIfPresent(String.self, forKey: .assignee)
        labels = try c.decodeIfPresent([String].self, forKey: .labels) ?? []
        createdBy = try c.decode(String.self, forKey: .createdBy)
        createdAt = try c.decodeU64(forKey: .createdAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encode(summary, forKey: .summary)
        try c.encode(impact, forKey: .impact)
        try c.encode(repro, forKey: .repro)
        try c.encode(resolutionCriteria, forKey: .resolutionCriteria)
        try c.encode(status, forKey: .status)
        try c.encode(priority, forKey: .priority)
        try c.encode(assignee, forKey: .assignee)
        try c.encode(labels, forKey: .labels)
        try c.encode(createdBy, forKey: .createdBy)
        try c.encode(String(createdAt), forKey: .createdAt)
    }
}

/// One comment in an issue's thread.
public struct CommentView: Codable, Sendable, Equatable {
    public var id: String
    public var issueId: String
    /// The writer's account id: only they may edit or delete it.
    public var author: String
    public var body: String
    /// Unix milliseconds.
    public var createdAt: UInt64
    /// Unix milliseconds of the last edit; `nil` if never edited.
    public var editedAt: UInt64?

    public init(
        id: String, issueId: String, author: String, body: String, createdAt: UInt64, editedAt: UInt64? = nil
    ) {
        self.id = id
        self.issueId = issueId
        self.author = author
        self.body = body
        self.createdAt = createdAt
        self.editedAt = editedAt
    }

    enum CodingKeys: String, CodingKey { case id, issueId, author, body, createdAt, editedAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        issueId = try c.decode(String.self, forKey: .issueId)
        author = try c.decode(String.self, forKey: .author)
        body = try c.decode(String.self, forKey: .body)
        createdAt = try c.decodeU64(forKey: .createdAt)
        editedAt = try c.decodeU64IfPresent(forKey: .editedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(issueId, forKey: .issueId)
        try c.encode(author, forKey: .author)
        try c.encode(body, forKey: .body)
        try c.encode(String(createdAt), forKey: .createdAt)
        try c.encode(editedAt.map(String.init), forKey: .editedAt)
    }
}

/// `getIssue`'s answer: the issue and its comments, oldest first (at most 1,000).
public struct IssueDetail: Codable, Sendable, Equatable {
    public var issue: IssueView
    public var comments: [CommentView]

    public init(issue: IssueView, comments: [CommentView]) {
        self.issue = issue
        self.comments = comments
    }
}

/// `getRepoInfo`'s answer.
public struct RepoInfo: Codable, Sendable, Equatable {
    public var repoUrl: String

    public init(repoUrl: String) {
        self.repoUrl = repoUrl
    }
}

/// One column's count in `getStatusCounts`.
public struct StatusCount: Codable, Sendable, Equatable {
    /// One of Open, In progress, Blocked, Done.
    public var status: String
    public var count: UInt64

    public init(status: String, count: UInt64) {
        self.status = status
        self.count = count
    }

    enum CodingKeys: String, CodingKey { case status, count }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decode(String.self, forKey: .status)
        count = try c.decodeU64(forKey: .count)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(status, forKey: .status)
        try c.encode(String(count), forKey: .count)
    }
}

extension KeyedDecodingContainer {
    /// A u64 the contract sends as a decimal string (a number is taken too).
    func decodeU64(forKey key: Key) throws -> UInt64 {
        if let text = try? decode(String.self, forKey: key) {
            guard let value = UInt64(text) else {
                throw DecodingError.dataCorruptedError(forKey: key, in: self, debugDescription: "not a u64: \(text)")
            }
            return value
        }
        return try decode(UInt64.self, forKey: key)
    }

    func decodeU64IfPresent(forKey key: Key) throws -> UInt64? {
        guard contains(key), try !decodeNil(forKey: key) else { return nil }
        return try decodeU64(forKey: key)
    }
}
