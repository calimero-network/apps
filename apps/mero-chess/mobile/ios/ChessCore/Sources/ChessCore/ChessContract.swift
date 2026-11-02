import Foundation
import MeroKit

/// The table's contract on Calimero 1.0, typed by hand from `logic/res/abi.json` (no client is
/// generated from a component ABI yet). The port of the web app's `src/chess.ts`, method for
/// method:
///
/// - method names are the ABI's camelCase ones (`offerDraw`, not v1's `offer_draw`);
/// - every `now` argument and every `u64` in an answer is a decimal string on the wire
///   (`createdAt`, `moves[].at`, `startedAt`); the types below read either a string or a number;
/// - answer fields are camelCase (`sideToMove`, `legalMoves`, `myTurn`, …);
/// - a refusal is `APP_ERROR {code, fields}` (MeroKit's ``AppError``), worded by
///   ``ChessContract/message(appCode:)``.
///
/// Views (`table`, `history`) go through `query`, everything else through `execute`.
public enum ChessContract {
    /// The ABI's calls (writes, through the app's log). `ContractTests` checks these against the
    /// committed ABI.
    public static let calls = [
        "join", "heartbeat", "sit", "stand", "play", "resign", "offerDraw", "acceptDraw", "declineDraw", "claimDraw",
        "rematch",
    ]
    /// The ABI's views (answered without writing).
    public static let views = ["table", "history"]

    /// v1's refusal sentences, by the error code that replaced each (the web app's `MESSAGES`).
    public static let messages: [String: String] = [
        "UnknownSeat": "a seat is either `white` or `black`",
        "SeatTaken": "that seat is taken",
        "NotSeated": "only a seated player can do that",
        "AlreadyPlayed": "you have played at this table — resign instead",
        "GameOver": "this game is over",
        "MoveLimit": "this game has reached the move limit",
        "WaitingForOpponent": "both seats must be taken before a move can be played",
        "NotYourMove": "it is not your move",
        "BadMove": "that is not a move in UCI notation",
        "IllegalMove": "that move is not legal in this position",
        "NoDrawOffer": "there is no draw offer to answer",
        "NoDrawToClaim": "there is no draw to claim in this position",
        "GameNotFinished": "finish this game first",
        "GameLimit": "this table has played all the games it counts",
    ]

    /// The sentence for a contract refusal, or `nil` for a code the app does not know.
    public static func message(appCode: String) -> String? { messages[appCode] }

    /// `init`'s arguments for a new table: both optional in the contract; `now` a decimal string.
    public static func initArgs(title: String, now: UInt64) -> JSONValue {
        .object(["title": .string(title), "now": .string(String(now))])
    }
}

/// Typed calls to one table's contract. (Swift side of the web app's `chess()`.)
public struct MeroChessClient: Sendable {
    public let transport: any ContextContractCalling

    public init(transport: any ContextContractCalling) {
        self.transport = transport
    }

    /// `MeroChessClient` for `contextId` (the table's app id) in the account's backend.
    public static func bound(_ backend: any MeroAppBackend, contextId: String) -> MeroChessClient {
        MeroChessClient(transport: backend.contract.bound(to: contextId))
    }

    // MARK: Views

    /// The whole table in one read.
    public func table(now: UInt64) async throws -> TableView {
        try await view("table", ["now": .string(String(now))])
    }

    /// Every game this table has played, oldest first.
    public func history() async throws -> [GameSummary] {
        try await view("history", [:])
    }

    // MARK: Calls

    /// Announce yourself at the table, or refresh your presence and name.
    public func join(name: String, now: UInt64) async throws { try await call("join", ["name": .string(name)], now) }
    /// Presence only.
    public func heartbeat(now: UInt64) async throws { try await call("heartbeat", [:], now) }
    /// Take the `white` or `black` chair, if it is free.
    public func sit(seat: String, name: String, now: UInt64) async throws {
        try await call("sit", ["seat": .string(seat), "name": .string(name)], now)
    }
    /// Give up your chair (only before you have played at this table).
    public func stand(now: UInt64) async throws { try await call("stand", [:], now) }

    /// Play a move in UCI (`e2e4`, `e7e8q`). Returns its SAN.
    @discardableResult
    public func play(uci: String, now: UInt64) async throws -> String {
        let data = try await execute("play", ["uci": .string(uci)], now)
        return try JSONDecoder().decode(String.self, from: data)
    }

    public func resign(now: UInt64) async throws { try await call("resign", [:], now) }
    public func offerDraw(now: UInt64) async throws { try await call("offerDraw", [:], now) }
    public func acceptDraw(now: UInt64) async throws { try await call("acceptDraw", [:], now) }
    public func declineDraw(now: UInt64) async throws { try await call("declineDraw", [:], now) }
    public func claimDraw(now: UInt64) async throws { try await call("claimDraw", [:], now) }

    /// Start the next game (colours swap). Returns its index.
    @discardableResult
    public func rematch(now: UInt64) async throws -> UInt32 {
        let data = try await execute("rematch", [:], now)
        return try JSONDecoder().decode(UInt32.self, from: data)
    }

    // MARK: Wire

    private func view<T: Decodable>(_ method: String, _ args: [String: JSONValue]) async throws -> T {
        let data = try await transport.query(method: method, argsJSON: try JSONEncoder().encode(JSONValue.object(args)))
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func call(_ method: String, _ args: [String: JSONValue], _ now: UInt64) async throws {
        _ = try await execute(method, args, now)
    }

    private func execute(_ method: String, _ args: [String: JSONValue], _ now: UInt64) async throws -> Data {
        var args = args
        args["now"] = .string(String(now))
        return try await transport.execute(method: method, argsJSON: try JSONEncoder().encode(JSONValue.object(args)))
    }
}

// MARK: - The answers

/// A `u64` off the wire: a decimal string (the component ABI), or a plain number.
struct WireU64: Codable, Hashable, Sendable {
    let value: UInt64

    init(_ value: UInt64) { self.value = value }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let text = try? c.decode(String.self) {
            guard let parsed = UInt64(text) else {
                throw DecodingError.dataCorruptedError(in: c, debugDescription: "not a u64: \(text)")
            }
            value = parsed
        } else {
            value = try c.decode(UInt64.self)
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(String(value))
    }
}

public struct SeatView: Codable, Sendable, Equatable {
    /// `white` or `black`: which chair this is, i.e. its colour in game 0.
    public var seat: String
    /// The account holding it, or `""` when the chair is free.
    public var member: String
    public var name: String
    public var online: Bool

    public init(seat: String, member: String, name: String, online: Bool) {
        self.seat = seat
        self.member = member
        self.name = name
        self.online = online
    }
}

public struct MoveView: Codable, Sendable, Equatable {
    public var ply: UInt32
    public var uci: String
    public var san: String
    public var by: String
    public var at: UInt64

    public init(ply: UInt32, uci: String, san: String, by: String, at: UInt64) {
        self.ply = ply
        self.uci = uci
        self.san = san
        self.by = by
        self.at = at
    }

    enum CodingKeys: String, CodingKey { case ply, uci, san, by, at }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ply = try c.decode(UInt32.self, forKey: .ply)
        uci = try c.decode(String.self, forKey: .uci)
        san = try c.decode(String.self, forKey: .san)
        by = try c.decode(String.self, forKey: .by)
        at = try c.decode(WireU64.self, forKey: .at).value
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(ply, forKey: .ply)
        try c.encode(uci, forKey: .uci)
        try c.encode(san, forKey: .san)
        try c.encode(by, forKey: .by)
        try c.encode(WireU64(at), forKey: .at)
    }
}

public struct PlayerView: Codable, Sendable, Equatable {
    public var id: String
    public var name: String
    public var online: Bool
    /// `white`, `black` or `""`: this player's colour in the current game.
    public var color: String

    public init(id: String, name: String, online: Bool, color: String) {
        self.id = id
        self.name = name
        self.online = online
        self.color = color
    }
}

public struct GameSummary: Codable, Sendable, Equatable {
    public var index: UInt32
    public var startedAt: UInt64
    public var result: String
    public var reason: String
    public var plies: UInt32
    /// The accounts that held the chairs when the game ended.
    public var white: String
    public var black: String

    public init(
        index: UInt32, startedAt: UInt64, result: String, reason: String, plies: UInt32, white: String, black: String
    ) {
        self.index = index
        self.startedAt = startedAt
        self.result = result
        self.reason = reason
        self.plies = plies
        self.white = white
        self.black = black
    }

    enum CodingKeys: String, CodingKey { case index, startedAt, result, reason, plies, white, black }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        index = try c.decode(UInt32.self, forKey: .index)
        startedAt = try c.decode(WireU64.self, forKey: .startedAt).value
        result = try c.decode(String.self, forKey: .result)
        reason = try c.decode(String.self, forKey: .reason)
        plies = try c.decode(UInt32.self, forKey: .plies)
        white = try c.decode(String.self, forKey: .white)
        black = try c.decode(String.self, forKey: .black)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(index, forKey: .index)
        try c.encode(WireU64(startedAt), forKey: .startedAt)
        try c.encode(result, forKey: .result)
        try c.encode(reason, forKey: .reason)
        try c.encode(plies, forKey: .plies)
        try c.encode(white, forKey: .white)
        try c.encode(black, forKey: .black)
    }
}

/// Everything a client needs to draw the table, in one read: position, legal moves, status and
/// result all come from the same replay of the move list.
public struct TableView: Codable, Sendable, Equatable {
    public var title: String
    public var createdAt: UInt64
    /// Index of the game being played now.
    public var game: UInt32
    /// The position after every move played, as a FEN.
    public var fen: String
    /// `white` or `black`.
    public var sideToMove: String
    public var moves: [MoveView]
    /// Every legal move in this position, in UCI, sorted (empty unless it is your move).
    public var legalMoves: [String]
    /// `awaitingPlayers`, `inProgress` or `finished`.
    public var status: String
    /// `1-0`, `0-1`, `1/2-1/2`, or `*` while unfinished.
    public var result: String
    /// Why it ended (`checkmate`, `resignation`, …), or `""`.
    public var reason: String
    public var check: Bool
    /// `threefold`, `fiftyMove` or `""`: a draw the side to move may claim.
    public var claimableDraw: String
    public var white: SeatView
    public var black: SeatView
    /// The caller's account, as the contract sees it.
    public var me: String
    /// The caller's colour in this game, or `""` for a spectator.
    public var myColor: String
    public var myTurn: Bool
    /// The account whose draw offer stands in this position, or `""`.
    public var drawOfferFrom: String
    /// In join order.
    public var players: [PlayerView]
    /// How many games this table has started, including the current one.
    public var gamesPlayed: UInt32

    public init(
        title: String, createdAt: UInt64, game: UInt32, fen: String, sideToMove: String, moves: [MoveView],
        legalMoves: [String], status: String, result: String, reason: String, check: Bool, claimableDraw: String,
        white: SeatView, black: SeatView, me: String, myColor: String, myTurn: Bool, drawOfferFrom: String,
        players: [PlayerView], gamesPlayed: UInt32
    ) {
        self.title = title
        self.createdAt = createdAt
        self.game = game
        self.fen = fen
        self.sideToMove = sideToMove
        self.moves = moves
        self.legalMoves = legalMoves
        self.status = status
        self.result = result
        self.reason = reason
        self.check = check
        self.claimableDraw = claimableDraw
        self.white = white
        self.black = black
        self.me = me
        self.myColor = myColor
        self.myTurn = myTurn
        self.drawOfferFrom = drawOfferFrom
        self.players = players
        self.gamesPlayed = gamesPlayed
    }

    enum CodingKeys: String, CodingKey {
        case title, createdAt, game, fen, sideToMove, moves, legalMoves, status, result, reason, check, claimableDraw
        case white, black, me, myColor, myTurn, drawOfferFrom, players, gamesPlayed
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decode(String.self, forKey: .title)
        createdAt = try c.decode(WireU64.self, forKey: .createdAt).value
        game = try c.decode(UInt32.self, forKey: .game)
        fen = try c.decode(String.self, forKey: .fen)
        sideToMove = try c.decode(String.self, forKey: .sideToMove)
        moves = try c.decode([MoveView].self, forKey: .moves)
        legalMoves = try c.decode([String].self, forKey: .legalMoves)
        status = try c.decode(String.self, forKey: .status)
        result = try c.decode(String.self, forKey: .result)
        reason = try c.decode(String.self, forKey: .reason)
        check = try c.decode(Bool.self, forKey: .check)
        claimableDraw = try c.decode(String.self, forKey: .claimableDraw)
        white = try c.decode(SeatView.self, forKey: .white)
        black = try c.decode(SeatView.self, forKey: .black)
        me = try c.decode(String.self, forKey: .me)
        myColor = try c.decode(String.self, forKey: .myColor)
        myTurn = try c.decode(Bool.self, forKey: .myTurn)
        drawOfferFrom = try c.decode(String.self, forKey: .drawOfferFrom)
        players = try c.decode([PlayerView].self, forKey: .players)
        gamesPlayed = try c.decode(UInt32.self, forKey: .gamesPlayed)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.encode(WireU64(createdAt), forKey: .createdAt)
        try c.encode(game, forKey: .game)
        try c.encode(fen, forKey: .fen)
        try c.encode(sideToMove, forKey: .sideToMove)
        try c.encode(moves, forKey: .moves)
        try c.encode(legalMoves, forKey: .legalMoves)
        try c.encode(status, forKey: .status)
        try c.encode(result, forKey: .result)
        try c.encode(reason, forKey: .reason)
        try c.encode(check, forKey: .check)
        try c.encode(claimableDraw, forKey: .claimableDraw)
        try c.encode(white, forKey: .white)
        try c.encode(black, forKey: .black)
        try c.encode(me, forKey: .me)
        try c.encode(myColor, forKey: .myColor)
        try c.encode(myTurn, forKey: .myTurn)
        try c.encode(drawOfferFrom, forKey: .drawOfferFrom)
        try c.encode(players, forKey: .players)
        try c.encode(gamesPlayed, forKey: .gamesPlayed)
    }
}
