import Foundation

// The tracker contract's component ABI (`logic/res/abi.json`, `calimero:app@0.5.0`),
// typed for the screens. Written by hand: abi-codegen has no target for a
// component ABI yet. Keep in step with the web client (`app/src/tracker.ts`)
// and the Kotlin one (`android/.../contract/IssueTrackerClient.kt`);
// `ContractWireTests` pins the method list and the argument names.
//
// On the wire:
// - method, argument and field names are camelCase (`createIssue`, `issueId`);
// - 64-bit integers (`createdAt`, `editedAt`, a status `count`) are decimal
//   strings; they are decoded from a string or a number and sent as strings;
// - a refusal is `422 APP_ERROR { code, fields }` (MeroKit's `AppError`), with
//   the codes `NotFound { id }`, `Invalid { message }` and `Forbidden { message }`.

/// Carries one call to an app instance and returns the method's JSON result.
///
/// `query` runs a view and `execute` runs a call. Both take the arguments as
/// a JSON object and return the JSON the method produced.
public protocol ContextContractCalling: Sendable {
    func query(method: String, argsJSON: Data) async throws -> Data
    func execute(method: String, argsJSON: Data) async throws -> Data
}

/// Typed calls to the tracker contract in one repository (app instance).
public struct IssueTrackerClient: Sendable {
    /// The contract's calls (writes), by their ABI names.
    public static let calls = [
        "setRepoUrl", "createIssue", "setStatus", "setSummary", "setImpact", "setRepro", "setResolutionCriteria",
        "setPriority", "setAssignee", "addLabel", "removeLabel", "addComment", "editComment", "deleteComment",
        "deleteIssue",
    ]
    /// The contract's views (reads), by their ABI names.
    public static let views = ["getRepoInfo", "listIssues", "getIssue", "getStatusCounts"]

    public let transport: any ContextContractCalling

    public init(transport: any ContextContractCalling) {
        self.transport = transport
    }

    // MARK: Views

    /// The repository's URL (`""` when unset).
    public func getRepoInfo() async throws -> RepoInfo {
        try await view("getRepoInfo", Empty())
    }

    /// Issues oldest first, at most the first 1,000 matches; `nil` is no filter.
    public func listIssues(status: String? = nil, assignee: String? = nil, label: String? = nil) async throws
        -> [IssueView]
    {
        try await view("listIssues", ListIssuesArgs(status: status, assignee: assignee, label: label))
    }

    /// One issue and its thread. `AppError` `NotFound` for an unknown issue.
    public func getIssue(issueId: String) async throws -> IssueDetail {
        try await view("getIssue", IssueArg(issueId: issueId))
    }

    /// Issues per status, in column order: Open, In progress, Blocked, Done.
    public func getStatusCounts() async throws -> [StatusCount] {
        try await view("getStatusCounts", Empty())
    }

    // MARK: Calls

    public func setRepoUrl(url: String) async throws {
        try await call("setRepoUrl", ["url": url])
    }

    /// File an issue; answers its id. New issues start in status `Open`.
    @discardableResult
    public func createIssue(
        title: String, summary: String, impact: String, repro: String, resolutionCriteria: String, priority: String,
        labels: [String]? = nil
    ) async throws -> String {
        try await callForId(
            "createIssue",
            CreateIssueArgs(
                title: title, summary: summary, impact: impact, repro: repro, resolutionCriteria: resolutionCriteria,
                priority: priority, labels: labels ?? []))
    }

    public func setStatus(issueId: String, status: String) async throws {
        try await call("setStatus", ["issueId": issueId, "status": status])
    }

    public func setSummary(issueId: String, summary: String) async throws {
        try await call("setSummary", ["issueId": issueId, "summary": summary])
    }

    public func setImpact(issueId: String, impact: String) async throws {
        try await call("setImpact", ["issueId": issueId, "impact": impact])
    }

    public func setRepro(issueId: String, repro: String) async throws {
        try await call("setRepro", ["issueId": issueId, "repro": repro])
    }

    public func setResolutionCriteria(issueId: String, resolutionCriteria: String) async throws {
        try await call("setResolutionCriteria", ["issueId": issueId, "resolutionCriteria": resolutionCriteria])
    }

    public func setPriority(issueId: String, priority: String) async throws {
        try await call("setPriority", ["issueId": issueId, "priority": priority])
    }

    /// `nil` clears the assignee.
    public func setAssignee(issueId: String, assignee: String? = nil) async throws {
        try await call("setAssignee", SetAssigneeArgs(issueId: issueId, assignee: assignee))
    }

    public func addLabel(issueId: String, label: String) async throws {
        try await call("addLabel", ["issueId": issueId, "label": label])
    }

    public func removeLabel(issueId: String, label: String) async throws {
        try await call("removeLabel", ["issueId": issueId, "label": label])
    }

    /// Post a comment; answers its id.
    @discardableResult
    public func addComment(issueId: String, body: String) async throws -> String {
        try await callForId("addComment", ["issueId": issueId, "body": body])
    }

    /// `AppError` `Forbidden` for anyone but the author.
    public func editComment(commentId: String, newBody: String) async throws {
        try await call("editComment", ["commentId": commentId, "newBody": newBody])
    }

    public func deleteComment(commentId: String) async throws {
        try await call("deleteComment", ["commentId": commentId])
    }

    /// Delete an issue with its labels and its whole thread. `AppError`
    /// `Forbidden` for anyone but its creator.
    public func deleteIssue(issueId: String) async throws {
        try await call("deleteIssue", ["issueId": issueId])
    }

    // MARK: Transport

    private func view<Args: Encodable, Answer: Decodable>(_ method: String, _ args: Args) async throws -> Answer {
        let response = try await transport.query(method: method, argsJSON: try JSONEncoder().encode(args))
        return try JSONDecoder().decode(Answer.self, from: response)
    }

    private func call<Args: Encodable>(_ method: String, _ args: Args) async throws {
        _ = try await transport.execute(method: method, argsJSON: try JSONEncoder().encode(args))
    }

    private func callForId<Args: Encodable>(_ method: String, _ args: Args) async throws -> String {
        let response = try await transport.execute(method: method, argsJSON: try JSONEncoder().encode(args))
        return try JSONDecoder().decode(String.self, from: response)
    }

    private struct Empty: Encodable {}

    private struct IssueArg: Encodable {
        let issueId: String
    }

    /// `null` filters are sent as `null` (the contract's `option<string>`).
    private struct ListIssuesArgs: Encodable {
        let status: String?
        let assignee: String?
        let label: String?

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(status, forKey: .status)
            try c.encode(assignee, forKey: .assignee)
            try c.encode(label, forKey: .label)
        }

        enum CodingKeys: String, CodingKey { case status, assignee, label }
    }

    private struct SetAssigneeArgs: Encodable {
        let issueId: String
        let assignee: String?

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(issueId, forKey: .issueId)
            try c.encode(assignee, forKey: .assignee)
        }

        enum CodingKeys: String, CodingKey { case issueId, assignee }
    }

    private struct CreateIssueArgs: Encodable {
        let title: String
        let summary: String
        let impact: String
        let repro: String
        let resolutionCriteria: String
        let priority: String
        let labels: [String]
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
