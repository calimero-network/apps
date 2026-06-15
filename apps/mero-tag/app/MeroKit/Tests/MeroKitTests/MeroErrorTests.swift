import XCTest
@testable import MeroKit

final class MeroErrorTests: XCTestCase {

    func testStringError() {
        XCTAssertEqual(MeroError.fromRpcError("boom"), .rpc(message: "boom"))
    }

    func testPrefersDataOverMessage() {
        let err: [String: Any] = ["message": "RPC error", "data": "tracker not found"]
        XCTAssertEqual(MeroError.fromRpcError(err), .rpc(message: "tracker not found"))
    }

    func testFallsBackToMessage() {
        let err: [String: Any] = ["message": "RPC error"]
        XCTAssertEqual(MeroError.fromRpcError(err), .rpc(message: "RPC error"))
    }

    func testEmptyDataIgnored() {
        let err: [String: Any] = ["message": "RPC error", "data": ""]
        XCTAssertEqual(MeroError.fromRpcError(err), .rpc(message: "RPC error"))
    }

    func testInMemoryTokenStore() {
        let store = InMemoryTokenStore(nodeUrl: "http://x", accessToken: "tok")
        XCTAssertEqual(store.accessToken, "tok")
        store.clear()
        XCTAssertNil(store.accessToken)
        XCTAssertNil(store.nodeUrl)
    }
}
