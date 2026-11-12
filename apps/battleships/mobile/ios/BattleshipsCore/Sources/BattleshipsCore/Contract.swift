import Foundation
import MeroKit

// The Battleships component contract (`../logic/res/abi.json`). The calls are `BattleshipsClient`,
// generated from it into `Generated/` by core's `mero-app-build codegen`
// (`scripts/mobile-codegen.sh`); this file keeps the method lists and the answer types of the web
// app's `src/battleships.ts`: camelCase method and argument names, snake_case result fields, 64-bit
// integers as decimal strings, bytes as base64url, refusals as `422 APP_ERROR {code, fields}`.
// (Kotlin `Contract.kt`.)

/// The contract's methods by their ABI names: a call goes through the app's log, a view is
/// answered by a node without writing. `ContractTests` checks both lists against the ABI.
public enum BattleshipsMethods {
    public static let calls = [
        "registerPlayer", "createMatch", "commitBoard", "proposeShot", "acknowledgeShot", "revealBoard",
    ]
    public static let views = [
        "getPlayers", "getMatches", "getPlayerStats", "getHistory", "getShots", "getIncomingShots",
        "getMatchState", "getActiveMatchId", "getCurrentTurn", "getWinner", "getCurrentUser",
    ]
}

// MARK: - Results

/// A u64 the contract answers as a decimal string (a number from an older node is read too).
struct U64: Decodable {
    let value: UInt64

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let text = try? c.decode(String.self), let parsed = UInt64(text) {
            value = parsed
        } else {
            value = try c.decode(UInt64.self)
        }
    }
}

public enum MatchStatus: String, Codable, Sendable, Equatable, CaseIterable {
    /// Until both fleets are committed.
    case pending = "Pending"
    case active = "Active"
    /// Once the audited result is recorded.
    case finished = "Finished"
}

public struct MatchSummary: Codable, Sendable, Equatable, Hashable {
    public var matchId: String
    public var player1: String
    public var player2: String
    public var player2Account: String
    public var status: MatchStatus
    public var winner: String?
    public var createdMs: UInt64

    public init(
        matchId: String, player1: String, player2: String, player2Account: String, status: MatchStatus,
        winner: String? = nil, createdMs: UInt64
    ) {
        self.matchId = matchId
        self.player1 = player1
        self.player2 = player2
        self.player2Account = player2Account
        self.status = status
        self.winner = winner
        self.createdMs = createdMs
    }

    enum CodingKeys: String, CodingKey {
        case matchId = "match_id"
        case player1, player2
        case player2Account = "player2_account"
        case status, winner
        case createdMs = "created_ms"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        matchId = try c.decode(String.self, forKey: .matchId)
        player1 = try c.decode(String.self, forKey: .player1)
        player2 = try c.decode(String.self, forKey: .player2)
        player2Account = try c.decodeIfPresent(String.self, forKey: .player2Account) ?? player2
        status = try c.decode(MatchStatus.self, forKey: .status)
        winner = try c.decodeIfPresent(String.self, forKey: .winner)
        createdMs = try c.decode(U64.self, forKey: .createdMs).value
    }

    /// The contract's shape: `created_ms` as a decimal string.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(matchId, forKey: .matchId)
        try c.encode(player1, forKey: .player1)
        try c.encode(player2, forKey: .player2)
        try c.encode(player2Account, forKey: .player2Account)
        try c.encode(status, forKey: .status)
        try c.encode(winner, forKey: .winner)
        try c.encode(String(createdMs), forKey: .createdMs)
    }
}

public struct MatchRecord: Codable, Sendable, Equatable, Hashable {
    public var matchId: String
    public var winner: String
    public var loser: String
    public var finishedMs: UInt64

    public init(matchId: String, winner: String, loser: String, finishedMs: UInt64) {
        self.matchId = matchId
        self.winner = winner
        self.loser = loser
        self.finishedMs = finishedMs
    }

    enum CodingKeys: String, CodingKey {
        case matchId = "match_id"
        case winner, loser
        case finishedMs = "finished_ms"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        matchId = try c.decode(String.self, forKey: .matchId)
        winner = try c.decode(String.self, forKey: .winner)
        loser = try c.decode(String.self, forKey: .loser)
        finishedMs = try c.decode(U64.self, forKey: .finishedMs).value
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(matchId, forKey: .matchId)
        try c.encode(winner, forKey: .winner)
        try c.encode(loser, forKey: .loser)
        try c.encode(String(finishedMs), forKey: .finishedMs)
    }
}

public struct PlayerStatsView: Codable, Sendable, Equatable {
    public var wins: UInt64
    public var losses: UInt64
    public var gamesPlayed: UInt64

    public init(wins: UInt64, losses: UInt64, gamesPlayed: UInt64) {
        self.wins = wins
        self.losses = losses
        self.gamesPlayed = gamesPlayed
    }

    enum CodingKeys: String, CodingKey {
        case wins, losses
        case gamesPlayed = "games_played"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        wins = try c.decode(U64.self, forKey: .wins).value
        losses = try c.decode(U64.self, forKey: .losses).value
        gamesPlayed = try c.decode(U64.self, forKey: .gamesPlayed).value
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(String(wins), forKey: .wins)
        try c.encode(String(losses), forKey: .losses)
        try c.encode(String(gamesPlayed), forKey: .gamesPlayed)
    }
}

/// Someone who opened the lobby. On 1.0 both fields are the account id.
public struct PlayerEntry: Codable, Sendable, Equatable, Hashable {
    public var account: String
    public var player: String

    public init(account: String, player: String) {
        self.account = account
        self.player = player
    }
}

/// The caller's shots (`getShots`) or the shots at the caller (`getIncomingShots`): one ``Cell``
/// byte per square, row-major.
public struct ShotsView: Codable, Sendable, Equatable {
    public var size: UInt32
    public var shots: [UInt8]

    public init(size: UInt32, shots: [UInt8]) {
        self.size = size
        self.shots = shots
    }
}

/// The shot waiting for its defender's answer.
public struct PendingShotView: Codable, Sendable, Equatable {
    /// What `acknowledgeShot` takes, so an answer meant for an earlier shot is refused.
    public var shotId: UInt32
    public var x: UInt32
    public var y: UInt32
    /// The player who has to answer.
    public var target: String

    public init(shotId: UInt32, x: UInt32, y: UInt32, target: String) {
        self.shotId = shotId
        self.x = x
        self.y = y
        self.target = target
    }

    enum CodingKeys: String, CodingKey {
        case shotId = "shot_id"
        case x, y, target
    }
}

/// The match as every reader derives it, in one read.
public struct MatchStateView: Codable, Sendable, Equatable {
    /// `playing`, `awaiting_reveal`, `won` or `void`.
    public var standing: String
    public var committed: [String]
    public var pendingShot: PendingShotView?
    /// `sunk` or `impossible_misses`; `nil` while playing.
    public var endedBy: String?
    public var loser: String?
    public var revealed: [String]
    public var auditFailed: [String]
    public var winner: String?

    public init(
        standing: String, committed: [String], pendingShot: PendingShotView? = nil, endedBy: String? = nil,
        loser: String? = nil, revealed: [String] = [], auditFailed: [String] = [], winner: String? = nil
    ) {
        self.standing = standing
        self.committed = committed
        self.pendingShot = pendingShot
        self.endedBy = endedBy
        self.loser = loser
        self.revealed = revealed
        self.auditFailed = auditFailed
        self.winner = winner
    }

    enum CodingKeys: String, CodingKey {
        case standing, committed
        case pendingShot = "pending_shot"
        case endedBy = "ended_by"
        case loser, revealed
        case auditFailed = "audit_failed"
        case winner
    }
}

// MARK: - Reading the generated client's answers

extension JSONValue {
    /// This answer as the app type `T`. The ABI names the contract's types (`MatchSummary`,
    /// `MatchStateView`, `ShotsView`, ...) without their shape until the logic derives `AbiType`,
    /// so the generated `BattleshipsClient` answers their JSON and the types above read it.
    func decoded<T: Decodable>(as type: T.Type) throws -> T {
        try MeroJSON.decode(type, from: MeroJSON.encode(self))
    }
}

/// Bytes as the contract takes them: base64url, no padding.
public enum Base64URL {
    public static func encode(_ bytes: [UInt8]) -> String {
        Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func decode(_ text: String) -> [UInt8]? {
        var base = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base.count % 4 != 0 { base += "=" }
        return Data(base64Encoded: base).map { [UInt8]($0) }
    }
}
