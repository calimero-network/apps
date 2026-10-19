import XCTest

@testable import MeroTag

@MainActor
final class NodeSessionTests: XCTestCase {
    func testABadNodeURLIsRefusedBeforeAnyCall() async {
        for bad in ["", "localhost:4001", "ftp://node", "http://"] {
            do {
                _ = try await NodeSession.connect(url: bad, username: "dev", password: "pw")
                XCTFail("\(bad) should be refused")
            } catch {
                XCTAssertEqual(error as? NodeSessionError, .badURL, bad)
            }
        }
    }

    func testNodeSignInNeedsCredentials() async {
        let app = AppState(preferences: SpacePreferences(defaults: UserDefaults(suiteName: #function)!))
        await app.signInToNode(url: "http://localhost:4001", username: "", password: "")
        XCTAssertEqual(app.nodeError, "Enter the node's admin username and password.")
        XCTAssertNil(app.node)
    }

    func testAnUnreachableNodeSaysSo() async {
        let app = AppState(preferences: SpacePreferences(defaults: UserDefaults(suiteName: #function)!))
        // Port 9 (discard) on loopback: nothing listens.
        await app.signInToNode(url: "http://127.0.0.1:9", username: "dev", password: "pw")
        XCTAssertNil(app.node)
        XCTAssertNotNil(app.nodeError)
        XCTAssertFalse(app.isConnectingNode)
    }

    func testSignedInToNoNodeMeansNoAccountAndNoSpaces() {
        let app = AppState(preferences: SpacePreferences(defaults: UserDefaults(suiteName: #function)!))
        XCTAssertNil(app.account)
        XCTAssertFalse(app.canCreateSpaces)
    }
}
