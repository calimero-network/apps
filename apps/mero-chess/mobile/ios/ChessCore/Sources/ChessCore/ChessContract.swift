import Foundation
import MeroKit

/// The table's contract on Calimero 1.0, as `logic/res/abi.json` declares it. The calls are the
/// generated `MeroChessClient`, and so are the answer types; this file keeps the method lists and
/// the refusal sentences the web app's `src/chess.ts` has:
///
/// - method names are the ABI's camelCase ones (`offerDraw`, not v1's `offer_draw`);
/// - every `now` argument and every `u64` in an answer is a decimal string on the wire
///   (`createdAt`, `moves[].at`, `startedAt`); the generated types read either a string or a number;
/// - answer fields are camelCase (`sideToMove`, `legalMoves`, `myTurn`, …);
/// - a refusal is `APP_ERROR {code, fields}` (MeroKit's ``AppError``), worded by
///   ``ChessContract/message(appCode:)``.
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

extension MeroChessClient {
    /// `MeroChessClient` (`Generated/`, written from `logic/res/abi.json` by
    /// `scripts/mobile-codegen.sh`) for `contextId` (the table's app id) in the account's backend.
    public static func bound(_ backend: any MeroAppBackend, contextId: String) -> MeroChessClient {
        MeroChessClient(backend: backend, app: contextId)
    }
}

// MARK: - The answers

/// The answer types are the generated client's (`Generated/MeroChessClient.swift`, from the ABI):
/// every `u64` (`createdAt`, `moves[].at`, `startedAt`) is a decimal string on the wire and a
/// `UInt64` here.
public typealias SeatView = MeroChessClient.SeatView
public typealias MoveView = MeroChessClient.MoveView
public typealias PlayerView = MeroChessClient.PlayerView
public typealias GameSummary = MeroChessClient.GameSummary
/// Everything a client needs to draw the table, in one read: position, legal moves, status and
/// result all come from the same replay of the move list.
public typealias TableView = MeroChessClient.TableView
