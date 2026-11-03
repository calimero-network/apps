import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import ChessCore

/// The typed client against the component contract's wire: camelCase methods and fields, `u64`s
/// as decimal strings, every method in the committed ABI.
final class ContractTests: XCTestCase {
    /// `logic/res/abi.json`'s methods (the web port, calimero-network/apps#716), minus `init`.
    static let abiCalls: Set<String> = [
        "acceptDraw", "claimDraw", "declineDraw", "heartbeat", "join", "offerDraw", "play", "rematch", "resign", "sit",
        "stand",
    ]
    static let abiViews: Set<String> = ["history", "table"]

    /// The committed ABI when this checkout has it (the web port merged), else the list above.
    private func abi() throws -> (calls: Set<String>, views: Set<String>) {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().appendingPathComponent("../../../../../logic/res/abi.json").standardized
        guard let data = try? Data(contentsOf: url),
            case .object(let root) = try JSONDecoder().decode(JSONValue.self, from: data),
            case .object(let methods)? = root["methods"]
        else { return (Self.abiCalls, Self.abiViews) }
        guard methods.values.contains(where: { $0["kind"] != nil }) else {
            // A v1 ABI (no `kind`): the component port is not on this branch yet.
            return (Self.abiCalls, Self.abiViews)
        }
        var calls = Set<String>()
        var views = Set<String>()
        for (name, method) in methods {
            switch method["kind"]?.stringValue {
            case "call": calls.insert(name)
            case "view": views.insert(name)
            default: break
            }
        }
        return (calls, views)
    }

    func testMethodListsMatchTheABI() throws {
        let abi = try abi()
        XCTAssertEqual(Set(ChessContract.calls), abi.calls)
        XCTAssertEqual(Set(ChessContract.views), abi.views)
    }

    func testEveryErrorCodeHasWords() {
        let codes = [
            "AlreadyPlayed", "BadMove", "GameLimit", "GameNotFinished", "GameOver", "IllegalMove", "MoveLimit",
            "NoDrawOffer", "NoDrawToClaim", "NotSeated", "NotYourMove", "SeatTaken", "UnknownSeat",
            "WaitingForOpponent",
        ]
        for code in codes { XCTAssertNotNil(ChessContract.message(appCode: code), code) }
    }

    func testCallsSendNowAsADecimalStringUnderCamelCaseNames() async throws {
        let backend = InMemoryAppBackend(account: Fixtures.me)
        backend.recording.setHandler { call in
            switch call.method {
            case "play": return .string("e4")
            case "rematch": return .number(2)
            default: return .null
            }
        }
        let client = MeroChessClient.bound(backend, contextId: "app1")
        let san = try await client.play(uci: "e2e4", now: 1_700_000_000_123)
        XCTAssertEqual(san, "e4")
        try await client.offerDraw(now: 5)
        try await client.sit(seat: "white", name: "Ana", now: 6)
        let game = try await client.rematch(now: 7)
        XCTAssertEqual(game, 2)

        let play = try XCTUnwrap(backend.recording.calls("play").first)
        XCTAssertEqual(play.path, .execute)
        XCTAssertEqual(play.contextId, "app1")
        XCTAssertEqual(play.args, .object(["uci": .string("e2e4"), "now": .string("1700000000123")]))
        XCTAssertEqual(backend.recording.calls("offerDraw").first?.args, .object(["now": .string("5")]))
        XCTAssertEqual(
            backend.recording.calls("sit").first?.args,
            .object(["seat": .string("white"), "name": .string("Ana"), "now": .string("6")]))
    }

    func testTableDecodesTheComponentAnswer() async throws {
        let wire = #"""
            {"title":"Friday","createdAt":"1700000000000","game":0,"fen":"8/8/8/8/8/8/8/8 w - - 0 1",
             "sideToMove":"white","moves":[{"ply":1,"uci":"e2e4","san":"e4","by":"acc1","at":"1700000000500"}],
             "legalMoves":["e7e5"],"status":"inProgress","result":"*","reason":"","check":false,"claimableDraw":"",
             "white":{"seat":"white","member":"acc1","name":"Ana","online":true},
             "black":{"seat":"black","member":"acc2","name":"Ben","online":false},
             "me":"acc2","myColor":"black","myTurn":true,"drawOfferFrom":"",
             "players":[{"id":"acc1","name":"Ana","online":true,"color":"white"}],"gamesPlayed":1}
            """#
        let backend = InMemoryAppBackend(account: Fixtures.me)
        let answer = try JSONDecoder().decode(JSONValue.self, from: Data(wire.utf8))
        backend.recording.setHandler { call in
            switch call.method {
            case "table": return answer
            case "history":
                return .array([
                    .object([
                        "index": .number(0), "startedAt": .string("1700000000000"), "result": .string("1-0"),
                        "reason": .string("resignation"), "plies": .number(12), "white": .string("acc1"),
                        "black": .string("acc2"),
                    ])
                ])
            default: return .null
            }
        }
        let client = MeroChessClient.bound(backend, contextId: "app1")
        let view = try await client.table(now: 9)
        XCTAssertEqual(backend.recording.calls("table").first?.path, .query)
        XCTAssertEqual(backend.recording.calls("table").first?.args, .object(["now": .string("9")]))
        XCTAssertEqual(view.createdAt, 1_700_000_000_000)
        XCTAssertEqual(view.moves.first?.at, 1_700_000_000_500)
        XCTAssertEqual(view.sideToMove, "white")
        XCTAssertEqual(view.legalMoves, ["e7e5"])
        XCTAssertTrue(view.myTurn)
        XCTAssertEqual(view.myColor, "black")
        let past = try await client.history()
        XCTAssertEqual(past.first?.startedAt, 1_700_000_000_000)
        XCTAssertEqual(past.first?.plies, 12)
    }

    func testInitArgsCarryNowAsADecimalString() {
        XCTAssertEqual(
            ChessContract.initArgs(title: "T", now: 42), .object(["title": .string("T"), "now": .string("42")]))
    }
}
