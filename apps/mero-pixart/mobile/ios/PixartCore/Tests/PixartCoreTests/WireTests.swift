import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import PixartCore

/// The client speaks the component contract's wire (`logic/res/abi.json`):
/// camelCase methods and arguments, top-level u64 / i64 arguments as decimal strings.
final class WireTests: XCTestCase {
    private func args(_ backend: InMemoryAppBackend, _ method: String) throws -> [String: Any] {
        let call = try XCTUnwrap(backend.recording.calls(method).first)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(call.argsJSON)) as? [String: Any])
    }

    func testIntegerArgumentsGoOutAsDecimalStrings() async throws {
        let backend = InMemoryAppBackend(account: "acct_1")
        let client = PixartClient(transport: backend.contract.bound(to: "app-1"))
        _ = try? await client.updateCursor(x: -12, y: 9_007_199_254_740_993, updatedAt: 42)
        let cursor = try args(backend, "updateCursor")
        XCTAssertEqual(cursor["x"] as? String, "-12")
        XCTAssertEqual(cursor["y"] as? String, "9007199254740993")
        XCTAssertEqual(cursor["updatedAt"] as? String, "42")

        _ = try? await client.updateLayer(id: "l1", visible: false, x: 5, updatedAt: 7)
        let layer = try args(backend, "updateLayer")
        XCTAssertEqual(layer["x"] as? String, "5")
        XCTAssertNil(layer["y"], "an unset optional is left out")
        XCTAssertEqual(layer["visible"] as? Bool, false)
        XCTAssertEqual(backend.recording.calls("updateLayer").first?.path, .execute)

        _ = try? await client.getLayers()
        XCTAssertEqual(backend.recording.calls("getLayers").first?.path, .query)
    }
}
