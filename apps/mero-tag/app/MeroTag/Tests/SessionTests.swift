import XCTest
import MeroKit
@testable import MeroTag

/// What happens when the node ends the session under the app's feet.
///
/// Access tokens live one hour. MeroKit refreshes them now, so this path is only
/// reached when a refresh cannot help — a revoked family, a replayed refresh
/// token, a grant the token does not carry. Before, none of those reached the UI
/// at all: the tab bar stayed up, the map kept its last positions, and every
/// call behind it was refused.
@MainActor
final class SessionTests: XCTestCase {
    private func makeApp() -> AppState {
        AppState(client: MeroClient(store: InMemoryTokenStore(
            nodeUrl: "http://node.test", accessToken: "tok", refreshToken: "ref")))
    }

    func testSessionEndedReturnsToLoginWithAReason() throws {
        let app = makeApp()
        app.phase = .ready
        app.sessionEnded(.tokenRevoked)

        XCTAssertEqual(app.phase, .loggedOut)
        let notice = try XCTUnwrap(app.sessionNotice)
        XCTAssertTrue(notice.contains("revoked"), "got: \(notice)")
        XCTAssertTrue(notice.hasSuffix("Please sign in again."))
    }

    /// Each terminal reason has to say something a human can act on — a bare
    /// "403" on a login screen is the version of this that already existed.
    func testEveryTerminalReasonProducesANotice() {
        for reason: AuthFailure in [.tokenRevoked, .tokenReuse, .permissionDenied, .invalidNode, .invalidToken] {
            let app = makeApp()
            app.phase = .ready
            app.sessionEnded(reason)
            XCTAssertEqual(app.phase, .loggedOut, "\(reason) must end the session")
            XCTAssertFalse(app.sessionNotice?.isEmpty ?? true, "\(reason) must explain itself")
        }
    }

    /// The handler can fire more than once (several calls in flight when the
    /// token died). Logging out twice must not resurrect anything.
    func testSessionEndedIsIdempotentOnceLoggedOut() {
        let app = makeApp()
        app.phase = .ready
        app.sessionEnded(.tokenRevoked)
        let first = app.sessionNotice
        app.sessionEnded(.tokenReuse)
        XCTAssertEqual(app.sessionNotice, first, "a second report must not overwrite the first reason")
        XCTAssertEqual(app.phase, .loggedOut)
    }

    func testLoggingOutDeliberatelyLeavesNoNotice() {
        let app = makeApp()
        app.phase = .ready
        app.logout()
        XCTAssertEqual(app.phase, .loggedOut)
        XCTAssertNil(app.sessionNotice)
    }
}
