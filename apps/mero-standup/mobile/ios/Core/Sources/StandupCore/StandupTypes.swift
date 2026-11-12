// The standup contract (`logic/`, a Calimero 1.0 component): the calls are `StandupClient`,
// generated from `logic/res/abi.json` into `Generated/` by core's `mero-app-build codegen`
// (`scripts/mobile-codegen.sh` at the repo root). This file keeps the answer types and the method
// table of the web app's `app/src/standup.ts`; the Android app's `contract/StandupContract.kt` is
// its twin.
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
import MeroKit

/// Carries one call to a context and returns the method’s JSON result.
///
/// `query` runs a view (a method the app declared `read_only`) and `execute`
/// runs everything else. Both take the arguments as a JSON object and return
/// the JSON the method produced.
extension Encodable {
    /// This answer as the app type `T` (one of the types below), read through its JSON: the
    /// generated `StandupClient` answers its own typed records.
    func decoded<T: Decodable>(as type: T.Type) throws -> T {
        try MeroJSON.decode(type, from: MeroJSON.encode(self))
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
