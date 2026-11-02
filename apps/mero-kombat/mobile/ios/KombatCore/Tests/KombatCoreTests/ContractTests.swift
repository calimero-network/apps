import Foundation
import MeroKit
import XCTest

@testable import KombatCore

/// The hand-typed client against the contract's component ABI: method names, camelCase fields and
/// u64 values as decimal strings. (Kotlin `ContractTest`.)
final class ContractTests: XCTestCase {
    /// `logic/res/abi.json`, from this package's directory.
    private var abiURL: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("../../../logic/res/abi.json").standardizedFileURL
    }

    func testTheMethodListsAreTheABIs() throws {
        let data = try Data(contentsOf: abiURL)
        let abi = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        // Until the component port (apps#711) is on this branch the ABI is the v1 one: nothing to compare.
        guard abi["world"] != nil, let methods = abi["methods"] as? [String: [String: Any]] else {
            throw XCTSkip("logic/res/abi.json is not a component ABI yet")
        }
        let calls = methods.filter { $0.value["kind"] as? String == "call" }.keys.sorted()
        let views = methods.filter { $0.value["kind"] as? String == "view" }.keys.sorted()
        XCTAssertEqual(calls, KombatClient.calls)
        XCTAssertEqual(views, KombatClient.views)
    }

    func testTheArenaReadsTheComponentWire() throws {
        let wire = #"""
            {"title":"Arena","createdAt":"1700000000000","matchIndex":2,"round":1,"status":"fighting",
             "roundResults":["p1"],"winner":"","flawless":false,
             "p1":{"seat":"p1","member":"acc_a","name":"Ana","fighter":"cryo","hp":80,"roundsWon":1,"matchesWon":0,"online":true},
             "p2":{"seat":"p2","member":"acc_b","name":"","fighter":"jinzo","hp":100,"roundsWon":0,"matchesWon":3,"online":false},
             "me":"acc_a","mySeat":"p1","hits":[{"by":"p1","id":7,"kind":"punch","damage":5,"blocked":false,"at":"1700000000123"}],
             "matchActions":4,"totalActions":"18446744073709551615","maxHp":100,"roundsToWin":2}
            """#
        let view = try JSONDecoder().decode(ArenaView.self, from: Data(wire.utf8))
        XCTAssertEqual(view.matchIndex, 2)
        XCTAssertEqual(view.mySeat, "p1")
        XCTAssertEqual(view.p2.matchesWon, 3)
        XCTAssertEqual(view.createdAt, 1_700_000_000_000)
        XCTAssertEqual(view.totalActions, UInt64.max, "a u64 keeps every digit")
        XCTAssertEqual(view.hits.first?.at, 1_700_000_000_123)

        let back = try XCTUnwrap(try JSONSerialization.jsonObject(with: JSONEncoder().encode(view)) as? [String: Any])
        XCTAssertEqual(back["totalActions"] as? String, "18446744073709551615")
        XCTAssertEqual(back["mySeat"] as? String, "p1")
    }

    func testTheHistoryReadsTheComponentWire() throws {
        let wire = #"[{"index":0,"startedAt":"5","winner":"p2","flawless":true,"rounds":["p2","p2"],"actions":12}]"#
        let past = try JSONDecoder().decode([MatchSummary].self, from: Data(wire.utf8))
        XCTAssertEqual(past, [MatchSummary(index: 0, startedAt: 5, winner: "p2", flawless: true, rounds: ["p2", "p2"], actions: 12)])
    }

    func testThePageStillReadsSnakeCase() throws {
        let json = try GameCalls.encode(Fixtures.arena())
        let page = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        XCTAssertEqual(page["my_seat"] as? String, "p1")
        XCTAssertEqual(page["match_index"] as? Int, 0)
        XCTAssertEqual((page["p1"] as? [String: Any])?["rounds_won"] as? Int, 0)
        XCTAssertNil(page["mySeat"])
    }

    func testInitArgsCarryNowAsADecimalString() {
        XCTAssertEqual(
            KombatClient.initArgs(title: "Friday", now: 42),
            .object(["title": .string("Friday"), "now": .string("42")]))
    }
}
