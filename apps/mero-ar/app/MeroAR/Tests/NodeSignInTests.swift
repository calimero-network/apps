import XCTest
import MeroKit
@testable import MeroAR

/// A node signed in to directly: what a failed login says, and that a
/// contract's refusal over JSON-RPC reads in the contract's words.
@MainActor
final class NodeSignInTests: XCTestCase {
    override func setUp() {
        super.setUp()
        RelayStub.reset()
    }

    func testNodeLoginTellsALockoutFromAWrongPassword() {
        let url = "http://localhost:2450"
        func http(_ status: Int, _ headers: [String: String] = [:]) -> MeroError {
            .http(HTTPError(status: status, statusText: "", url: "\(url)/auth/token", headers: headers))
        }
        XCTAssertEqual(
            AppState.nodeLoginMessage(MeroError.authenticationFailed("bad"), url: url),
            "The node refused that username or password.")
        XCTAssertEqual(
            AppState.nodeLoginMessage(http(429, ["retry-after": "1"]), url: url),
            "Too many failed attempts. Try again in 1 second.")
        XCTAssertEqual(AppState.nodeLoginMessage(http(429), url: url), "Too many failed attempts. Try again later.")
        XCTAssertEqual(
            AppState.nodeLoginMessage(http(404), url: url), "No node sign-in at \(url). Check the URL and port.")
        XCTAssertEqual(
            AppState.nodeLoginMessage(MeroError.network("offline"), url: url),
            "Can't reach a node at \(url). Is merod running?")
    }

    func testARefusedNodeCallSurfacesTheContractsReason() async {
        let ctx = Fixture.context()
        RelayStub.on(
            "POST", "/jsonrpc",
            json: #"{"jsonrpc":"2.0","id":1,"error":{"type":"FunctionCallError","data":"view-only: ask an admin"}}"#)
        do {
            try await NodeTransport(mero: Fixture.mero(), nodeURL: Fixture.relayURL)
                .execute(contextId: ctx, method: "delete_object", args: ["id": "o1"])
            XCTFail("a refused call was reported as success")
        } catch {
            XCTAssertEqual(userMessage(error), "view-only: ask an admin")
        }
    }
}
