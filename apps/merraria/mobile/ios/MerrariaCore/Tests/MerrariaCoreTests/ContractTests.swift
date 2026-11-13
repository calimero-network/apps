import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import MerrariaCore

/// The hand-typed client against the contract's component ABI: method names, paging and the
/// contract's refusals in words. (Kotlin `ContractTest`.)
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
        // Until the component port (apps#710) is on this branch the ABI is the v1 one: nothing to compare.
        guard abi["world"] != nil, let methods = abi["methods"] as? [String: [String: Any]] else {
            throw XCTSkip("logic/res/abi.json is not a component ABI yet")
        }
        let calls = methods.filter { $0.value["kind"] as? String == "call" }.keys.sorted()
        let views = methods.filter { $0.value["kind"] as? String == "view" }.keys.sorted()
        XCTAssertEqual(calls, MerrariaClient.calls)
        XCTAssertEqual(views, MerrariaClient.views)
    }

    func testOverridesAreReadPageByPage() async throws {
        let backend = InMemoryAppBackend()
        backend.recording.setHandler { call in
            // The generated client leaves an unset `option` argument out, which the contract
            // reads as none, as it does `null`.
            switch call.args["cursor"] {
            case nil, .null?: return .object(["items": .array([.object(["k": "1,2", "t": 3])]), "next": "a"])
            case .string("a")?: return .object(["items": .array([.object(["k": "3,4", "t": 0])]), "next": "b"])
            default: return .object(["items": .array([]), "next": .null])
            }
        }
        let all = try await MerrariaClient.bound(backend, contextId: "w1").allOverrides()
        XCTAssertEqual(all, [TileEntry(k: "1,2", t: 3), TileEntry(k: "3,4", t: 0)])
        XCTAssertEqual(backend.recording.calls.map(\.method), ["getOverrides", "getOverrides", "getOverrides"])
    }

    func testTheContractsRefusalsReadAsWords() {
        func refusal(_ code: String, _ fields: [String: JSONValue] = [:]) -> String {
            MerrariaText.error(AppError("refused", details: ["code": .string(code), "fields": .object(fields)]))
        }
        XCTAssertEqual(refusal("WorldFull", ["max": .number(1000)]), "This world is full (1000 players). Try another world.")
        XCTAssertEqual(refusal("TooManyEdits", ["max": .number(512)]), "Too many tile changes at once (at most 512). Try again.")
        XCTAssertEqual(refusal("NoWorld"), "This world is still being created. Try again in a moment.")
        XCTAssertEqual(MerrariaText.error(ConfirmCancelled()), "Cancelled. Nothing was sent.")
        XCTAssertEqual(MerrariaText.error(LoginRequired("expired")), "Your session ended. Sign in again.")
    }

    func testNowIsAU32() {
        XCTAssertEqual(u32(1_700_000_000.9), 1_700_000_000)
        XCTAssertEqual(u32(-1), 0)
        XCTAssertEqual(u32(1e12), UInt32.max)
    }
}
