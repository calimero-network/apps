// The standup contract (`logic/`, a Calimero 1.0 component), typed: the phone's
// copy of the web app's `app/src/standup.ts`, against the same
// `logic/res/abi.json` (web PR #709). Hand-written: no client is generated from
// a component ABI yet. The Android app's `contract/StandupClient.kt` is its twin.
//
// What the component ABI changed from v1, and how this file follows it:
// - method, argument and result names are camelCase (`postUpdate`, `fromDay`,
//   `authorName`, `nextCursor`); unknown argument keys are refused, so every
//   optional argument is written, as `null` when absent;
// - 64-bit timestamps are decimal strings (read by the `UInt64` decoding below);
//   counts stay `u32` numbers;
// - accounts are the cluster's account ids, as opaque strings;
// - a refusal is the node's `APP_ERROR` with the contract's `{ code, fields }`
//   (`StandupAppCode`), which `ErrorText` puts into words.

import Foundation

/// Carries one call to a context and returns the method’s JSON result.
///
/// `query` runs a view (a method the app declared `read_only`) and `execute`
/// runs everything else. Both take the arguments as a JSON object and return
/// the JSON the method produced.
public protocol ContextContractCalling: Sendable {
    func query(method: String, argsJSON: Data) async throws -> Data
    func execute(method: String, argsJSON: Data) async throws -> Data
}

/// Typed calls to the contract. Views go through `query`, writes through `execute`.
public struct StandupClient: Sendable {
    public let transport: any ContextContractCalling

    public init(transport: any ContextContractCalling) {
        self.transport = transport
    }

    /// `clearUpdate`
    ///
    /// Withdraw the caller's standup for `day`.
    ///
    /// Write (`mutating`): sent with `execute`.
    public func clearUpdate(day: String) async throws {
        let args = try JSONEncoder().encode(ClearUpdateArgs(day: day))
        _ = try await transport.execute(method: "clearUpdate", argsJSON: args)
    }

    /// `currentBlockers`
    ///
    /// What is blocking the team right now: each member's LATEST update, if
    /// it names a blocker. An old blocker someone has since posted past is
    /// not current, so only the newest update per member counts.
    ///
    /// View (`read_only`): sent with `query`.
    public func currentBlockers() async throws -> [UpdateView] {
        let response = try await transport.query(method: "currentBlockers", argsJSON: Data("{}".utf8))
        return try JSONDecoder().decode([UpdateView].self, from: response)
    }

    /// `getDay`
    ///
    /// Everyone's standup for one day, ordered by author.
    ///
    /// View (`read_only`): sent with `query`.
    public func getDay(day: String) async throws -> DayView {
        let args = try JSONEncoder().encode(GetDayArgs(day: day))
        let response = try await transport.query(method: "getDay", argsJSON: args)
        return try JSONDecoder().decode(DayView.self, from: response)
    }

    /// `getDecision`
    ///
    /// One decision by id.
    ///
    /// View (`read_only`): sent with `query`.
    public func getDecision(id: String) async throws -> DecisionView {
        let args = try JSONEncoder().encode(GetDecisionArgs(id: id))
        let response = try await transport.query(method: "getDecision", argsJSON: args)
        return try JSONDecoder().decode(DecisionView.self, from: response)
    }

    /// `getName`
    ///
    /// The name `account` chose, or "".
    ///
    /// View (`read_only`): sent with `query`.
    public func getName(account: String) async throws -> String {
        let args = try JSONEncoder().encode(GetNameArgs(account: account))
        let response = try await transport.query(method: "getName", argsJSON: args)
        return try JSONDecoder().decode(String.self, from: response)
    }

    /// `getWeek`
    ///
    /// Seven days of standups starting at `start`, oldest first: the weekly
    /// digest in one call instead of seven.
    ///
    /// View (`read_only`): sent with `query`.
    public func getWeek(start: String) async throws -> [DayView] {
        let args = try JSONEncoder().encode(GetWeekArgs(start: start))
        let response = try await transport.query(method: "getWeek", argsJSON: args)
        return try JSONDecoder().decode([DayView].self, from: response)
    }

    /// `listDays`
    ///
    /// Days with at least one live update, newest first, strictly before
    /// `before` when it is given (the previous page's `next_cursor`).
    ///
    /// View (`read_only`): sent with `query`.
    public func listDays(before: String? = nil, limit: UInt32) async throws -> DayPage {
        let args = try JSONEncoder().encode(ListDaysArgs(before: before, limit: limit))
        let response = try await transport.query(method: "listDays", argsJSON: args)
        return try JSONDecoder().decode(DayPage.self, from: response)
    }

    /// `listDecisions`
    ///
    /// The log, newest first. `search` keeps decisions whose title, text,
    /// rationale or tags contain it (case-insensitive); `tag` keeps those
    /// carrying exactly that tag; `from_day` those logged from that standup
    /// day; `standing_only` drops the superseded ones. `cursor` is the
    /// previous page's `next_cursor`.
    ///
    /// View (`read_only`): sent with `query`.
    public func listDecisions(search: String? = nil, tag: String? = nil, fromDay: String? = nil, standingOnly: Bool, cursor: String? = nil, limit: UInt32) async throws -> DecisionPage {
        let args = try JSONEncoder().encode(ListDecisionsArgs(search: search, tag: tag, fromDay: fromDay, standingOnly: standingOnly, cursor: cursor, limit: limit))
        let response = try await transport.query(method: "listDecisions", argsJSON: args)
        return try JSONDecoder().decode(DecisionPage.self, from: response)
    }

    /// `logDecision`
    ///
    /// Record a decision. Returns its id.
    ///
    /// `supersedes` names the decision this one replaces. It must exist and
    /// still stand when this is written; on read the link only counts if the
    /// replaced decision is older (see `superseded_by`).
    ///
    /// `tags`, `with` (accounts involved) and `from_day` (the standup day it
    /// came out of) are the v2 notes, written beside the decision.
    ///
    /// Write (`mutating`): sent with `execute`.
    @discardableResult
    public func logDecision(title: String, decision: String, rationale: String, supersedes: String? = nil, tags: [String], with: [String], fromDay: String? = nil) async throws -> String {
        let args = try JSONEncoder().encode(LogDecisionArgs(title: title, decision: decision, rationale: rationale, supersedes: supersedes, tags: tags, with: with, fromDay: fromDay))
        let response = try await transport.execute(method: "logDecision", argsJSON: args)
        return try JSONDecoder().decode(String.self, from: response)
    }

    /// members
    ///
    /// Everyone who has posted an update or chosen a name, with the latest day
    /// they posted for. The UI uses it for "still to post today".
    ///
    /// Not the context's membership: a member who never touched the app is
    /// not in here, and the contract has no way to list them.
    ///
    /// View (`read_only`): sent with `query`.
    public func members() async throws -> [MemberView] {
        let response = try await transport.query(method: "members", argsJSON: Data("{}".utf8))
        return try JSONDecoder().decode([MemberView].self, from: response)
    }

    /// `offerHelp`
    ///
    /// Offer to help with `author`'s blocker on `day`, or change your note.
    /// The update has to exist and name a blocker, and you cannot offer
    /// yourself help.
    ///
    /// Write (`mutating`): sent with `execute`.
    public func offerHelp(day: String, author: String, note: String) async throws {
        let args = try JSONEncoder().encode(OfferHelpArgs(day: day, author: author, note: note))
        _ = try await transport.execute(method: "offerHelp", argsJSON: args)
    }

    /// `postUpdate`
    ///
    /// Post, or rewrite, the caller's standup for `day` (`YYYY-MM-DD`).
    ///
    /// The day comes from the client because "today" is the member's local
    /// date, which the contract cannot know. At least one field must say
    /// something; `blockers` may stay empty, and usually does.
    ///
    /// Write (`mutating`): sent with `execute`.
    public func postUpdate(day: String, done: String, next: String, blockers: String) async throws {
        let args = try JSONEncoder().encode(PostUpdateArgs(day: day, done: done, next: next, blockers: blockers))
        _ = try await transport.execute(method: "postUpdate", argsJSON: args)
    }

    /// `setName`
    ///
    /// Claim a display name for the calling account. An empty name clears it.
    ///
    /// No `account` argument: you can only name yourself, and `UserStorage`
    /// holds every node to that, not just this one.
    ///
    /// Write (`mutating`): sent with `execute`.
    public func setName(name: String) async throws {
        let args = try JSONEncoder().encode(SetNameArgs(name: name))
        _ = try await transport.execute(method: "setName", argsJSON: args)
    }

    /// `setTeamName`
    ///
    /// Name the team. Any member may; an empty name clears it.
    ///
    /// Write (`mutating`): sent with `execute`.
    public func setTeamName(name: String) async throws {
        let args = try JSONEncoder().encode(SetTeamNameArgs(name: name))
        _ = try await transport.execute(method: "setTeamName", argsJSON: args)
    }

    /// tags
    ///
    /// Every tag in the log with how many decisions carry it, most used first.
    ///
    /// View (`read_only`): sent with `query`.
    public func tags() async throws -> [TagCount] {
        let response = try await transport.query(method: "tags", argsJSON: Data("{}".utf8))
        return try JSONDecoder().decode([TagCount].self, from: response)
    }

    /// `teamName`
    ///
    /// The team's name, or "" if nobody has named it.
    ///
    /// View (`read_only`): sent with `query`.
    public func teamName() async throws -> String {
        let response = try await transport.query(method: "teamName", argsJSON: Data("{}".utf8))
        return try JSONDecoder().decode(String.self, from: response)
    }

    /// whoami
    ///
    /// The calling account, as the views render it. The frontend uses it to
    /// find "my" update in a day without a second identity lookup.
    ///
    /// View (`read_only`): sent with `query`.
    public func whoami() async throws -> String {
        let response = try await transport.query(method: "whoami", argsJSON: Data("{}".utf8))
        return try JSONDecoder().decode(String.self, from: response)
    }

    /// `withdrawHelp`
    ///
    /// Take back your offer on `author`'s update for `day`.
    ///
    /// Write (`mutating`): sent with `execute`.
    public func withdrawHelp(day: String, author: String) async throws {
        let args = try JSONEncoder().encode(WithdrawHelpArgs(day: day, author: author))
        _ = try await transport.execute(method: "withdrawHelp", argsJSON: args)
    }

    private struct ClearUpdateArgs: Encodable {
        let day: String
    }

    private struct GetDayArgs: Encodable {
        let day: String
    }

    private struct GetDecisionArgs: Encodable {
        let id: String
    }

    private struct GetNameArgs: Encodable {
        let account: String
    }

    private struct GetWeekArgs: Encodable {
        let start: String
    }

    private struct ListDaysArgs: Encodable {
        let before: String?
        let limit: UInt32

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(before, forKey: .before)
            try c.encode(limit, forKey: .limit)
        }

        enum CodingKeys: String, CodingKey { case before, limit }
    }

    private struct ListDecisionsArgs: Encodable {
        let search: String?
        let tag: String?
        let fromDay: String?
        let standingOnly: Bool
        let cursor: String?
        let limit: UInt32

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(search, forKey: .search)
            try c.encode(tag, forKey: .tag)
            try c.encode(fromDay, forKey: .fromDay)
            try c.encode(standingOnly, forKey: .standingOnly)
            try c.encode(cursor, forKey: .cursor)
            try c.encode(limit, forKey: .limit)
        }

        enum CodingKeys: String, CodingKey {
            case search
            case tag
            case fromDay
            case standingOnly
            case cursor
            case limit
        }
    }

    private struct LogDecisionArgs: Encodable {
        let title: String
        let decision: String
        let rationale: String
        let supersedes: String?
        let tags: [String]
        let with: [String]
        let fromDay: String?

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(title, forKey: .title)
            try c.encode(decision, forKey: .decision)
            try c.encode(rationale, forKey: .rationale)
            try c.encode(supersedes, forKey: .supersedes)
            try c.encode(tags, forKey: .tags)
            try c.encode(with, forKey: .with)
            try c.encode(fromDay, forKey: .fromDay)
        }

        enum CodingKeys: String, CodingKey {
            case title
            case decision
            case rationale
            case supersedes
            case tags
            case with
            case fromDay
        }
    }

    private struct OfferHelpArgs: Encodable {
        let day: String
        let author: String
        let note: String
    }

    private struct PostUpdateArgs: Encodable {
        let day: String
        let done: String
        let next: String
        let blockers: String
    }

    private struct SetNameArgs: Encodable {
        let name: String
    }

    private struct SetTeamNameArgs: Encodable {
        let name: String
    }

    private struct WithdrawHelpArgs: Encodable {
        let day: String
        let author: String
    }
}

// MARK: - Types

/// Days with at least one update, newest first.
public struct DayPage: Codable, Sendable, Equatable {
    public var days: [DaySummary]
    /// Pass back as `before` for the next page; `None` at the end.
    public var nextCursor: String?

    public init(days: [DaySummary], nextCursor: String? = nil) {
        self.days = days
        self.nextCursor = nextCursor
    }

    enum CodingKeys: String, CodingKey {
        case days
        case nextCursor
    }
}

public struct DaySummary: Codable, Sendable, Equatable {
    public var day: String
    /// How many members posted that day.
    public var updates: UInt32
    /// How many of those named a blocker.
    public var blocked: UInt32

    public init(day: String, updates: UInt32, blocked: UInt32) {
        self.day = day
        self.updates = updates
        self.blocked = blocked
    }
}

/// Everyone's standup for one day.
public struct DayView: Codable, Sendable, Equatable {
    public var day: String
    /// Ordered by author, so every node lists them the same way.
    public var updates: [UpdateView]

    public init(day: String, updates: [UpdateView]) {
        self.day = day
        self.updates = updates
    }
}

public struct DecisionPage: Codable, Sendable, Equatable {
    public var items: [DecisionView]
    /// Pass back as `cursor` for the next page; `None` at the end.
    public var nextCursor: String?

    public init(items: [DecisionView], nextCursor: String? = nil) {
        self.items = items
        self.nextCursor = nextCursor
    }

    enum CodingKeys: String, CodingKey {
        case items
        case nextCursor
    }
}

public struct DecisionView: Codable, Sendable, Equatable {
    public var id: String
    public var author: String
    public var authorName: String
    public var title: String
    public var decision: String
    public var rationale: String
    /// The decision this one replaces, or "" — only when that claim holds.
    public var supersedes: String
    /// The decision that replaced this one, or "" while it stands.
    public var supersededBy: String
    public var createdAt: UInt64
    /// v2 notes; empty for a decision logged before v2.
    public var tags: [String]
    public var with: [PersonView]
    /// The standup day it came out of, or "".
    public var fromDay: String

    public init(id: String, author: String, authorName: String, title: String, decision: String, rationale: String, supersedes: String, supersededBy: String, createdAt: UInt64, tags: [String], with: [PersonView], fromDay: String) {
        self.id = id
        self.author = author
        self.authorName = authorName
        self.title = title
        self.decision = decision
        self.rationale = rationale
        self.supersedes = supersedes
        self.supersededBy = supersededBy
        self.createdAt = createdAt
        self.tags = tags
        self.with = with
        self.fromDay = fromDay
    }

    enum CodingKeys: String, CodingKey {
        case id
        case author
        case authorName
        case title
        case decision
        case rationale
        case supersedes
        case supersededBy
        case createdAt
        case tags
        case with
        case fromDay
    }
}

/// An offer to help with a blocker.
public struct HelpView: Codable, Sendable, Equatable {
    public var account: String
    public var name: String
    public var note: String
    public var at: UInt64

    public init(account: String, name: String, note: String, at: UInt64) {
        self.account = account
        self.name = name
        self.note = note
        self.at = at
    }
}

/// Someone who has taken part: posted an update or named themselves.
public struct MemberView: Codable, Sendable, Equatable {
    public var account: String
    public var name: String
    /// The latest day they posted for, or "" if they never have.
    public var lastDay: String

    public init(account: String, name: String, lastDay: String) {
        self.account = account
        self.name = name
        self.lastDay = lastDay
    }

    enum CodingKeys: String, CodingKey {
        case account
        case name
        case lastDay
    }
}

/// Someone named in a view, with the name they chose ("" if none).
public struct PersonView: Codable, Sendable, Equatable {
    public var account: String
    public var name: String

    public init(account: String, name: String) {
        self.account = account
        self.name = name
    }
}

/// A tag and how many decisions carry it.
public struct TagCount: Codable, Sendable, Equatable {
    public var tag: String
    public var count: UInt32

    public init(tag: String, count: UInt32) {
        self.tag = tag
        self.count = count
    }
}

public struct UpdateView: Codable, Sendable, Equatable {
    public var day: String
    public var author: String
    /// The author's chosen name, or "" when they have not set one.
    public var authorName: String
    public var done: String
    public var next: String
    public var blockers: String
    public var createdAt: UInt64
    public var editedAt: UInt64
    /// Teammates who offered to help with the blocker, oldest offer first.
    /// Empty when there is no blocker.
    public var helpers: [HelpView]

    public init(day: String, author: String, authorName: String, done: String, next: String, blockers: String, createdAt: UInt64, editedAt: UInt64, helpers: [HelpView]) {
        self.day = day
        self.author = author
        self.authorName = authorName
        self.done = done
        self.next = next
        self.blockers = blockers
        self.createdAt = createdAt
        self.editedAt = editedAt
        self.helpers = helpers
    }

    enum CodingKeys: String, CodingKey {
        case day
        case author
        case authorName
        case done
        case next
        case blockers
        case createdAt
        case editedAt
        case helpers
    }
}

// MARK: - The component ABI's details

/// The contract's methods, as `abi.json` names them.
public enum StandupMethods {
    public static let calls = ["postUpdate", "clearUpdate", "logDecision", "offerHelp", "withdrawHelp", "setTeamName", "setName"]
    public static let views = [
        "whoami", "getDay", "listDays", "currentBlockers", "members", "getDecision", "listDecisions", "tags", "getWeek",
        "teamName", "getName",
    ]
}

/// The contract's error codes (`#[app::error]`), as `APP_ERROR` carries them.
public enum StandupAppCode: String, Sendable, CaseIterable {
    case notADate = "NotADate"
    case tooLong = "TooLong"
    case empty = "Empty"
    case tooMany = "TooMany"
    case noUpdate = "NoUpdate"
    case noSuchUpdate = "NoSuchUpdate"
    case noBlocker = "NoBlocker"
    case ownBlocker = "OwnBlocker"
    case noHelp = "NoHelp"
    case noSuchDecision = "NoSuchDecision"
    case alreadySuperseded = "AlreadySuperseded"
}

extension KeyedDecodingContainer {
    /// A `u64` the contract writes as a decimal string; a number (an older
    /// answer, a test fixture) is read too. Used by every synthesized decoder
    /// in this module.
    func decode(_ type: UInt64.Type, forKey key: Key) throws -> UInt64 {
        if let text = try? decode(String.self, forKey: key), let value = UInt64(text) { return value }
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return UInt64(max(0, value)) }
        return try decodeIfPresent(Int64.self, forKey: key).map { UInt64(max(0, $0)) } ?? 0
    }
}
