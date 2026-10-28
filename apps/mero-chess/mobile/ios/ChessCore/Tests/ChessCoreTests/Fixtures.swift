import Foundation
import MeroChessGenerated
import MeroKit
import MeroKitTestSupport

enum Fixtures {
    static let me = String(repeating: "ab", count: 32)
    static let them = String(repeating: "cd", count: 32)
    static let start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    static let openingMoves = [
        "a2a3", "a2a4", "b1a3", "b1c3", "b2b3", "b2b4", "c2c3", "c2c4", "d2d3", "d2d4", "e2e3", "e2e4",
        "f2f3", "f2f4", "g1f3", "g1h3", "g2g3", "g2g4", "h2h3", "h2h4",
    ]

    static func seat(_ color: String, _ member: String, _ name: String) -> SeatView {
        SeatView(seat: color, member: member, name: name, online: true)
    }

    /// A table where I hold White and it is my move at the start.
    static func table(
        fen: String = start, legal: [String] = openingMoves, myColor: String = "white", myTurn: Bool = true,
        status: String = "inProgress", result: String = "*", reason: String = "", moves: [MoveView] = [],
        white: SeatView? = nil, black: SeatView? = nil, drawOfferFrom: String = "", check: Bool = false,
        sideToMove: String = "white", game: UInt32 = 0, gamesPlayed: UInt32 = 1
    ) -> TableView {
        TableView(
            title: "Friday game", createdAt: 1, game: game, fen: fen, sideToMove: sideToMove, moves: moves,
            legalMoves: legal, status: status, result: result, reason: reason, check: check, claimableDraw: "",
            white: white ?? seat("white", me, "Ana"), black: black ?? seat("black", them, "Ben"), me: me,
            myColor: myColor, myTurn: myTurn, drawOfferFrom: drawOfferFrom, players: [], gamesPlayed: gamesPlayed)
    }

    static func json<T: Encodable>(_ value: T) -> JSONValue {
        let data = try! JSONEncoder().encode(value)
        return try! JSONDecoder().decode(JSONValue.self, from: data)
    }
}

/// A scriptable contract: answers `table` with whatever `view` holds, `history` with `[]`, and
/// records every call (via the SDK's `RecordingContextContract`).
final class TableScript: @unchecked Sendable {
    let lock = NSLock()
    private var _view: TableView
    private var _refuse: [String: String] = [:]

    init(_ view: TableView) { _view = view }

    var view: TableView {
        get { lock.lock(); defer { lock.unlock() }; return _view }
        set { lock.lock(); _view = newValue; lock.unlock() }
    }

    func refuse(_ method: String, _ message: String) {
        lock.lock(); _refuse[method] = message; lock.unlock()
    }

    func install(on recording: RecordingContextContract) {
        recording.setHandler { [self] call in
            lock.lock()
            let refusal = _refuse[call.method]
            let view = _view
            lock.unlock()
            if let refusal { throw Refusal(message: refusal) }
            switch call.method {
            case "table": return Fixtures.json(view)
            case "history": return .array([])
            case "play": return .string("e4")
            case "rematch": return .number(1)
            default: return .null
            }
        }
    }
}

struct Refusal: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
