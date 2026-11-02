import Foundation
import MeroKit

// The arena contract's component ABI (`logic/res/abi.json`, `calimero:app@0.5.0`), typed by hand:
// no Swift client is generated from a component ABI yet. It mirrors the web app's
// `app/src/kombat.ts`, and `ContractTests` checks the method lists against the committed ABI.
// (Kotlin `network.calimero.kombat.contract.KombatClient`.)
//
// Wire format (component ABI):
// - argument and result fields are camelCase (`matchIndex`, `mySeat`, `roundsWon`, …);
// - every `u64` travels as a decimal string (`now`, `createdAt`, `totalActions`, `hits[].at`,
//   `startedAt`); the Swift fields stay `UInt64` and are converted here;
// - a refusal is `422 APP_ERROR {code, fields}`, an `AppError` (see `KombatRefusal`).

/// Typed calls to the arena. Views go through `query` (`POST /apps/{app}/views`), calls through
/// `execute` (an intent).
public struct KombatClient: Sendable {
    /// The contract's calls (writes), by their ABI names.
    public static let calls = ["act", "join", "pick", "rematch", "sit", "stand"]
    /// The contract's views (reads), by their ABI names.
    public static let views = ["arena", "history"]

    public let transport: any ContextContractCalling

    public init(transport: any ContextContractCalling) {
        self.transport = transport
    }

    /// Record one blow in round `round` of match `matchIndex`.
    public func act(matchIndex: UInt32, round: UInt32, id: UInt32, kind: String, hit: Bool, blocked: Bool, now: UInt64)
        async throws
    {
        try await call(
            "act",
            ActArgs(matchIndex: matchIndex, round: round, id: id, kind: kind, hit: hit, blocked: blocked, now: U64(now)))
    }

    /// The whole arena in one read.
    public func arena(now: UInt64) async throws -> ArenaView {
        try JSONDecoder().decode(ArenaView.self, from: try await view("arena", NowArgs(now: U64(now))))
    }

    /// Every match this arena has fought, oldest first.
    public func history() async throws -> [MatchSummary] {
        try JSONDecoder().decode([MatchSummary].self, from: try await view("history", Empty()))
    }

    /// Announce yourself, or refresh your name and fighter.
    public func join(name: String, fighter: String, now: UInt64) async throws {
        try await call("join", JoinArgs(name: name, fighter: fighter, now: U64(now)))
    }

    /// Change fighter.
    public func pick(fighter: String, now: UInt64) async throws {
        try await call("pick", PickArgs(fighter: fighter, now: U64(now)))
    }

    /// Start the next match; answers its index.
    @discardableResult
    public func rematch(now: UInt64) async throws -> UInt32 {
        let data = try await transport.execute(method: "rematch", argsJSON: try JSONEncoder().encode(NowArgs(now: U64(now))))
        return try JSONDecoder().decode(UInt32.self, from: data)
    }

    /// Take corner `p1` or `p2`, if it is free.
    public func sit(seat: String, name: String, fighter: String, now: UInt64) async throws {
        try await call("sit", SitArgs(seat: seat, name: name, fighter: fighter, now: U64(now)))
    }

    /// Leave your corner (only before you have fought here).
    public func stand(now: UInt64) async throws {
        try await call("stand", NowArgs(now: U64(now)))
    }

    /// The `init` arguments a new arena instance is created with (`init(title?, now?)`).
    public static func initArgs(title: String, now: UInt64) -> JSONValue {
        .object(["title": .string(title), "now": .string(String(now))])
    }

    private func call<A: Encodable>(_ method: String, _ args: A) async throws {
        _ = try await transport.execute(method: method, argsJSON: try JSONEncoder().encode(args))
    }

    private func view<A: Encodable>(_ method: String, _ args: A) async throws -> Data {
        try await transport.query(method: method, argsJSON: try JSONEncoder().encode(args))
    }

    private struct Empty: Encodable {}
    private struct NowArgs: Encodable { let now: U64 }
    private struct JoinArgs: Encodable {
        let name: String
        let fighter: String
        let now: U64
    }
    private struct PickArgs: Encodable {
        let fighter: String
        let now: U64
    }
    private struct SitArgs: Encodable {
        let seat: String
        let name: String
        let fighter: String
        let now: U64
    }
    private struct ActArgs: Encodable {
        let matchIndex: UInt32
        let round: UInt32
        let id: UInt32
        let kind: String
        let hit: Bool
        let blocked: Bool
        let now: U64
    }
}

/// A `u64` on the wire: a decimal string. Reads a bare number too (an older node, a fixture).
struct U64: Codable, Hashable, Sendable {
    let value: UInt64
    init(_ value: UInt64) { self.value = value }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let text = try? container.decode(String.self) {
            guard let value = UInt64(text) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "not a u64: \(text)")
            }
            self.value = value
        } else {
            value = try container.decode(UInt64.self)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(String(value))
    }
}

extension KeyedDecodingContainer {
    fileprivate func u64(_ key: Key) throws -> UInt64 { try decode(U64.self, forKey: key).value }
}

extension KeyedEncodingContainer {
    fileprivate mutating func u64(_ value: UInt64, _ key: Key) throws { try encode(U64(value), forKey: key) }
}

/// Everything the arena draws, in one read (the contract's `ArenaView`).
public struct ArenaView: Codable, Sendable, Equatable {
    public var title: String
    public var createdAt: UInt64
    /// The match being fought now.
    public var matchIndex: UInt32
    /// The round being fought now (0-based).
    public var round: UInt32
    /// `waiting`, `fighting` or `finished`.
    public var status: String
    /// One entry per decided round of this match: `p1` or `p2`.
    public var roundResults: [String]
    /// `p1`, `p2`, or `""` while the match is on.
    public var winner: String
    public var flawless: Bool
    public var p1: FighterView
    public var p2: FighterView
    /// The caller's account id.
    public var me: String
    /// `p1`, `p2`, or `""` for a spectator.
    public var mySeat: String
    /// This round's landed blows, in log order.
    public var hits: [HitView]
    /// Actions written in the current match, both corners.
    public var matchActions: UInt32
    /// Every action ever written at this arena: the transaction count.
    public var totalActions: UInt64
    public var maxHp: UInt32
    public var roundsToWin: UInt32

    public init(
        title: String, createdAt: UInt64, matchIndex: UInt32, round: UInt32, status: String, roundResults: [String],
        winner: String, flawless: Bool, p1: FighterView, p2: FighterView, me: String, mySeat: String, hits: [HitView],
        matchActions: UInt32, totalActions: UInt64, maxHp: UInt32, roundsToWin: UInt32
    ) {
        self.title = title
        self.createdAt = createdAt
        self.matchIndex = matchIndex
        self.round = round
        self.status = status
        self.roundResults = roundResults
        self.winner = winner
        self.flawless = flawless
        self.p1 = p1
        self.p2 = p2
        self.me = me
        self.mySeat = mySeat
        self.hits = hits
        self.matchActions = matchActions
        self.totalActions = totalActions
        self.maxHp = maxHp
        self.roundsToWin = roundsToWin
    }

    enum CodingKeys: String, CodingKey {
        case title, createdAt, matchIndex, round, status, roundResults, winner, flawless, p1, p2, me, mySeat, hits
        case matchActions, totalActions, maxHp, roundsToWin
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decode(String.self, forKey: .title)
        createdAt = try c.u64(.createdAt)
        matchIndex = try c.decode(UInt32.self, forKey: .matchIndex)
        round = try c.decode(UInt32.self, forKey: .round)
        status = try c.decode(String.self, forKey: .status)
        roundResults = try c.decode([String].self, forKey: .roundResults)
        winner = try c.decode(String.self, forKey: .winner)
        flawless = try c.decode(Bool.self, forKey: .flawless)
        p1 = try c.decode(FighterView.self, forKey: .p1)
        p2 = try c.decode(FighterView.self, forKey: .p2)
        me = try c.decode(String.self, forKey: .me)
        mySeat = try c.decode(String.self, forKey: .mySeat)
        hits = try c.decode([HitView].self, forKey: .hits)
        matchActions = try c.decode(UInt32.self, forKey: .matchActions)
        totalActions = try c.u64(.totalActions)
        maxHp = try c.decode(UInt32.self, forKey: .maxHp)
        roundsToWin = try c.decode(UInt32.self, forKey: .roundsToWin)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.u64(createdAt, .createdAt)
        try c.encode(matchIndex, forKey: .matchIndex)
        try c.encode(round, forKey: .round)
        try c.encode(status, forKey: .status)
        try c.encode(roundResults, forKey: .roundResults)
        try c.encode(winner, forKey: .winner)
        try c.encode(flawless, forKey: .flawless)
        try c.encode(p1, forKey: .p1)
        try c.encode(p2, forKey: .p2)
        try c.encode(me, forKey: .me)
        try c.encode(mySeat, forKey: .mySeat)
        try c.encode(hits, forKey: .hits)
        try c.encode(matchActions, forKey: .matchActions)
        try c.u64(totalActions, .totalActions)
        try c.encode(maxHp, forKey: .maxHp)
        try c.encode(roundsToWin, forKey: .roundsToWin)
    }
}

/// One corner (the contract's `FighterView`).
public struct FighterView: Codable, Sendable, Equatable {
    /// `p1` or `p2`.
    public var seat: String
    /// The account in this corner, or `""` when it is empty.
    public var member: String
    public var name: String
    public var fighter: String
    /// Health left in the current round.
    public var hp: UInt32
    public var roundsWon: UInt32
    /// Matches this corner has won at this arena.
    public var matchesWon: UInt32
    public var online: Bool

    public init(
        seat: String, member: String, name: String, fighter: String, hp: UInt32, roundsWon: UInt32, matchesWon: UInt32,
        online: Bool
    ) {
        self.seat = seat
        self.member = member
        self.name = name
        self.fighter = fighter
        self.hp = hp
        self.roundsWon = roundsWon
        self.matchesWon = matchesWon
        self.online = online
    }
}

/// One blow of the current round (the contract's `HitView`).
public struct HitView: Codable, Sendable, Equatable {
    /// The corner that threw it.
    public var by: String
    /// The thrower's own sequence number.
    public var id: UInt32
    public var kind: String
    public var damage: UInt32
    public var blocked: Bool
    public var at: UInt64

    public init(by: String, id: UInt32, kind: String, damage: UInt32, blocked: Bool, at: UInt64) {
        self.by = by
        self.id = id
        self.kind = kind
        self.damage = damage
        self.blocked = blocked
        self.at = at
    }

    enum CodingKeys: String, CodingKey { case by, id, kind, damage, blocked, at }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        by = try c.decode(String.self, forKey: .by)
        id = try c.decode(UInt32.self, forKey: .id)
        kind = try c.decode(String.self, forKey: .kind)
        damage = try c.decode(UInt32.self, forKey: .damage)
        blocked = try c.decode(Bool.self, forKey: .blocked)
        at = try c.u64(.at)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(by, forKey: .by)
        try c.encode(id, forKey: .id)
        try c.encode(kind, forKey: .kind)
        try c.encode(damage, forKey: .damage)
        try c.encode(blocked, forKey: .blocked)
        try c.u64(at, .at)
    }
}

/// One match of the arena's record (the contract's `MatchSummary`).
public struct MatchSummary: Codable, Sendable, Equatable {
    public var index: UInt32
    public var startedAt: UInt64
    public var winner: String
    public var flawless: Bool
    public var rounds: [String]
    public var actions: UInt32

    public init(index: UInt32, startedAt: UInt64, winner: String, flawless: Bool, rounds: [String], actions: UInt32) {
        self.index = index
        self.startedAt = startedAt
        self.winner = winner
        self.flawless = flawless
        self.rounds = rounds
        self.actions = actions
    }

    enum CodingKeys: String, CodingKey { case index, startedAt, winner, flawless, rounds, actions }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        index = try c.decode(UInt32.self, forKey: .index)
        startedAt = try c.u64(.startedAt)
        winner = try c.decode(String.self, forKey: .winner)
        flawless = try c.decode(Bool.self, forKey: .flawless)
        rounds = try c.decode([String].self, forKey: .rounds)
        actions = try c.decode(UInt32.self, forKey: .actions)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(index, forKey: .index)
        try c.u64(startedAt, .startedAt)
        try c.encode(winner, forKey: .winner)
        try c.encode(flawless, forKey: .flawless)
        try c.encode(rounds, forKey: .rounds)
        try c.encode(actions, forKey: .actions)
    }
}

/// The contract's refusals (`#[app::error]`), in the words the web app shows (`kombat.ts`
/// `MESSAGES`). (Kotlin `KombatRefusal`.)
public enum KombatRefusal {
    public static let messages: [String: String] = [
        "UnknownSeat": "A corner is either p1 or p2.",
        "UnknownFighter": "Unknown fighter.",
        "UnknownMove": "Unknown move.",
        "CornerTaken": "That corner is taken.",
        "InOtherCorner": "You are already in the other corner.",
        "NotInCorner": "Only a fighter in a corner can do that.",
        "AlreadyFought": "You have already fought here.",
        "WaitingForOpponent": "Waiting for an opponent.",
        "MatchOver": "This match is over.",
        "WrongMatch": "That match is not being fought.",
        "RoundOver": "That round is over.",
        "ActionLimit": "This round has reached its action limit.",
        "MatchNotFinished": "Finish this match first.",
        "MatchLimit": "This arena has fought all the matches it counts.",
    ]

    /// The sentence for an `APP_ERROR` code, or nil for a code the contract does not declare.
    public static func message(code: String) -> String? { messages[code] }
}
